/**
 * mdnsDnsSdDiscovery — real multicast DNS-SD for the Node mDNS backend, so a laptop is actually visible to
 * the phones on the Wi-Fi.
 *
 * This is the ONLY file in the mDNS path that needs a library. It fills the seam
 * `mdnsNodeBackend` declares — `advertise()` / `browse()` — and nothing else imports it, so a build that
 * does not want multicast never loads `bonjour-service`.
 *
 * ── The underscore, which is a real trap ─────────────────────────────────────────────────────────────────
 * Our wire constant is `_onderling` (matching `MdnsTransport.SERVICE_TYPE` and the Android `NsdManager`
 * call, which appends `._tcp.` itself). `bonjour-service` takes the type WITHOUT the leading underscore and
 * WITHOUT the protocol suffix, and builds `_onderling._tcp.local` from it. Pass `_onderling` through
 * unchanged and it publishes `__onderling._tcp` — a service nothing is looking for, advertised perfectly,
 * with no error anywhere. `dnsSdType()` below is that one character, isolated and tested, because the
 * symptom of getting it wrong is silence rather than a failure.
 *
 * ── What the peers exchange ─────────────────────────────────────────────────────────────────────────────
 * The TXT record carries `pubKey` — the agent's address. That is the whole identity payload; the transport
 * proves possession afterwards over TCP. A record without a `pubKey` is ignored rather than guessed at.
 */
import os from 'node:os';
import fs from 'node:fs';
import Bonjour from 'bonjour-service';
import { SERVICE_TYPE } from './MdnsTransport.js';

/**
 * Strip the leading underscore our constant carries, because the library adds its own.
 * Exported for the test that pins this against `SERVICE_TYPE`.
 */
export function dnsSdType(serviceType) {
  return String(serviceType ?? SERVICE_TYPE).replace(/^_/, '');
}

/**
 * The SRV record's target: this host's name in the `.local` domain. Left to the library, the target is the bare
 * `os.hostname()` (`surface-go.`), and every resolver — Android's NSD on the phone included — then asks UNICAST DNS
 * for a name only multicast DNS answers, finds nothing, and the service is listed but never resolved (found on the
 * household tablet, 2026-10-25: an empty room with the companion announcing correctly). A name that already ends in
 * `.local` (a laptop that reports it that way) is kept as it is.
 */
export function srvHost(hostname) {
  const name = String(hostname ?? '').replace(/\.+$/, '');
  return /\.local$/i.test(name) ? name : `${name}.local`;
}

/**
 * The interface the default route leaves by, from the kernel's route table (`/proc/net/route`'s text): the home LAN's,
 * the same rule the box's firewall uses (`lan_iface`). Null when there is no default route or no table.
 * @param {string} routeTable
 * @returns {string|null}
 */
export function defaultRouteInterface(routeTable) {
  for (const line of String(routeTable ?? '').split('\n').slice(1)) {
    const [iface, dest, , , , , , mask] = line.trim().split(/\s+/);
    if (iface && dest === '00000000' && (mask === undefined || mask === '00000000')) return iface;
  }
  return null;
}

/** The addresses an interface holds, in the shape `os.networkInterfaces()` reports them. */
export function lanAddressesOf(interfaces, name) {
  return ((interfaces ?? {})[name] ?? []).filter((a) => a && !a.internal).map((a) => a.address);
}

// interfaces that are never the room: container bridges and their veths, VM bridges, overlay and VPN tunnels
const NOT_THE_LAN = /^(docker|br-|veth|virbr|cni|flannel|cali|tailscale|zt|wg|tun|tap)/;

/** The addresses a host may publish for itself: the LAN interface's, or (none known) every interface that is not a bridge or tunnel. */
function publishableAddresses(interfaces, lan) {
  if (lan && lanAddressesOf(interfaces, lan).length) return new Set(lanAddressesOf(interfaces, lan));
  return new Set(Object.entries(interfaces ?? {}).filter(([n]) => !NOT_THE_LAN.test(n)).flatMap(([n]) => lanAddressesOf(interfaces, n)));
}

/** The kernel's route table, read where the process can see it (a container on host networking sees the host's). */
function readRouteTable() {
  try { return fs.readFileSync('/proc/net/route', 'utf8'); } catch { return ''; }
}

/**
 * Build the DNS-SD seam.
 *
 * @param {object} [opts]
 * @param {object} [opts.bonjour]  inject an instance (tests); otherwise one is created lazily and shared
 * @param {() => string} [opts.hostname]  this host's name (tests); the OS's otherwise
 * @param {() => (string|null)} [opts.lanInterface]  the room's interface (COMPANION_NEARBY_IFACE, else the default route's)
 * @param {() => object} [opts.interfaces]  the host's interfaces (tests); `os.networkInterfaces()` otherwise
 * @returns {{advertise:Function, browse:Function, destroy:Function}}
 */
export function createDnsSdDiscovery({
  bonjour = null, hostname = () => os.hostname(),
  // which interface is the room (the operator's override, else the default route's), and the host's interfaces (tests)
  lanInterface = () => process.env.COMPANION_NEARBY_IFACE || defaultRouteInterface(readRouteTable()),
  interfaces = () => os.networkInterfaces(),
} = {}) {
  let instance = bonjour;
  const ensure = () => (instance ??= new Bonjour());

  return {
    /**
     * Publish `_<type>._tcp` on the LAN with `pubKey` in the TXT record.
     * @returns {Promise<() => void>} stop — unpublishes; the listening socket is not this function's
     *   business (going unlisted is about who can find you, not who can reach you).
     */
    async advertise({ serviceType, serviceName, port, txt }) {
      const service = ensure().publish({
        name:     serviceName,
        type:     dnsSdType(serviceType),
        protocol: 'tcp',
        host:     srvHost(hostname()),
        port,
        txt,
      });
      // The host's address records: the library answers every non-internal interface, docker bridges included, and a
      // phone that resolves this host then dials a bridge it cannot reach. Only the LAN's addresses are published. The
      // library reads `records()` after its name probe, so narrowing it here is in time for the first announcement.
      const allowed = publishableAddresses(interfaces(), lanInterface());
      if (typeof service?.records === 'function') {
        const all = service.records.bind(service);
        service.records = () => all().filter((r) => (r?.type !== 'A' && r?.type !== 'AAAA') || allowed.has(r.data));
      }
      return () => { try { service.stop?.(); } catch { /* unpublish is best-effort */ } };
    },

    /**
     * Browse for the same service type. `onFound` is called per discovered peer with the shape the backend
     * re-emits as `MdnsServiceDiscovered`.
     *
     * IPv4 is preferred deliberately: the transport dials a single host:port, and an IPv6 address that the
     * local interface cannot route is a connect that hangs rather than a peer that is skipped.
     */
    async browse({ serviceType, onFound, onLost }) {
      const browser = ensure().find({ type: dnsSdType(serviceType), protocol: 'tcp' });

      const emitUp = (service) => {
        const pubKey = service?.txt?.pubKey;
        if (!pubKey) return;                       // no identity in the record — not ours to guess
        const host = (service.addresses ?? []).find((a) => a.includes('.'))
          ?? service.referer?.address
          ?? service.host;
        if (!host || !service.port) return;
        onFound({ host, port: service.port, pubKey });
      };

      browser.on('up', emitUp);
      if (typeof onLost === 'function') {
        browser.on('down', (service) => {
          const pubKey = service?.txt?.pubKey;
          if (pubKey) onLost({ pubKey });
        });
      }
      browser.start?.();

      return () => { try { browser.stop?.(); } catch { /* best-effort */ } };
    },

    /** Tear the shared responder down — call when the process is shutting the transport for good. */
    destroy() {
      try { instance?.destroy?.(); } finally { instance = null; }
    },
  };
}
