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
 * Build the DNS-SD seam.
 *
 * @param {object} [opts]
 * @param {object} [opts.bonjour]  inject an instance (tests); otherwise one is created lazily and shared
 * @returns {{advertise:Function, browse:Function, destroy:Function}}
 */
export function createDnsSdDiscovery({ bonjour = null } = {}) {
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
        port,
        txt,
      });
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
