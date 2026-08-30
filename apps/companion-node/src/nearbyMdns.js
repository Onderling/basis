/**
 * nearbyMdns — the companion's local-network radio, as a removable plugin.
 *
 * A companion is a device of yours, and a device of yours on the same Wi-Fi should be discoverable like any
 * other. This composes the pieces that already exist — the mDNS routing layer, its Node backend, the
 * DNS-SD seam — into the two things the host needs: a transport, and a peer source the nearby surface can
 * subscribe to.
 *
 * ── Removable by construction ────────────────────────────────────────────────────────────────────────────
 * `startCompanionNode` calls this only when `nearby` is set. Absent, this module is never imported, so
 * `bonjour-service` is never loaded and the process behaves exactly as it did before. Nothing registers a
 * plugin; the host's existing option pattern IS the mechanism.
 *
 * ── Browse, do not publish (Frits, 2026-08-30) ──────────────────────────────────────────────────────────
 * A phone advertises only while someone is looking at the Nearby view. A companion has no view, so that
 * rule has no meaning here and the default falls out of nothing — which is why it was decided rather than
 * assumed. A node advertising `_onderling._tcp` with a stable `pubKey`, permanently, on your home network
 * is a presence beacon with a stable identifier that anyone on that network can watch. On a phone the
 * exposure lasts as long as someone is looking; here it would be always.
 *
 * So the default is **browse**: the companion can see the room and remains reachable by peers that already
 * know it, and announces nothing. `publish: true` is an explicit act, and `publishFor` bounds it in time so
 * "advertise for an hour" does not silently become forever.
 */
import { MdnsTransport } from '@onderling/transports/mdns';
import { createMdnsNodeBackend } from '@onderling/transports/mdns-node';
import { createDnsSdDiscovery } from '@onderling/transports/mdns-dnssd';
import { createNearbyPeerSource, DISCOVERABILITY } from '@onderling/core';

/**
 * @param {object} a
 * @param {import('@onderling/core').AgentIdentity} a.identity  the companion's own identity
 * @param {object} [a.opts]                 the host's `nearby` option, normalised by the caller
 * @param {string} [a.opts.label]           mDNS service name (default: derived from the pubKey)
 * @param {boolean} [a.opts.publish=false]  announce ourselves — see the note above
 * @param {number} [a.opts.publishFor]      ms after which advertising reverts to browse-only
 * @param {object} [a.discovery]            inject the DNS-SD seam (tests); else a real one
 * @returns {Promise<{transport, nearbyPeers, state, stop}>}
 */
export async function startNearbyMdns({ identity, opts = {}, discovery = null } = {}) {
  if (!identity) throw new Error('startNearbyMdns: identity required');

  const dnssd = discovery ?? createDnsSdDiscovery();
  const { native, emitter } = createMdnsNodeBackend({ discovery: dnssd });
  const transport = new MdnsTransport({
    identity,
    hostname: opts.label || undefined,
    native,
    emitter,
  });

  // The nearby surface reads this and nothing else — the same source the phone's mesh builder hands it, so
  // the companion appears in a room through the ordinary path rather than a special case.
  const nearbyPeers = createNearbyPeerSource({ transports: () => ({ mdns: transport }) });

  const wanted = opts.publish === true ? DISCOVERABILITY.PUBLISH : DISCOVERABILITY.BROWSE;
  // `setDiscoverability` reports what was ACHIEVED, including `degraded` when a transport ended up more
  // exposed than asked. Keep the whole verdict rather than the request: the caller needs to be able to say
  // "asked to browse, actually announcing" instead of quietly believing the ask.
  let state = await transport.setDiscoverability(wanted);

  // A time-boxed announcement. Deliberately one-way: it can expire back to browse, never escalate.
  let revert = null;
  if (state.effective === DISCOVERABILITY.PUBLISH && Number.isFinite(opts.publishFor) && opts.publishFor > 0) {
    revert = setTimeout(async () => {
      try { state = await transport.setDiscoverability(DISCOVERABILITY.BROWSE); } catch { /* best-effort */ }
    }, opts.publishFor);
    revert.unref?.();   // an expiry timer must never hold the process open
  }

  return {
    transport,
    nearbyPeers,
    /** The full verdict from the transport — `{ok, requested, effective, degraded, reason?}`. What we are
     *  ACTUALLY doing, not what was asked for. */
    get state() { return state; },
    async stop() {
      if (revert) clearTimeout(revert);
      try { nearbyPeers.close(); } catch { /* best-effort */ }
      try { await transport.disconnect(); } catch { /* best-effort */ }
      try { dnssd.destroy?.(); } catch { /* best-effort */ }
    },
  };
}

/**
 * Normalise the host's `nearby` option. `false`/absent means the plugin never loads, which the caller
 * checks before importing this module — so this only ever sees a truthy value.
 */
export function normaliseNearbyOption(nearby) {
  if (nearby === true) return { mdns: true };
  if (!nearby || typeof nearby !== 'object') return null;
  return nearby.mdns ? { ...nearby } : null;
}
