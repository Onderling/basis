import { createDiscoverabilityControl } from './discoverability.js';
import { createNearbyPeerSource } from './nearbyPeers.js';

/**
 * The mesh SURFACE — the discoverability control and the nearby peer source, as one object an app can
 * hold from boot, over a set of transports that may land later.
 *
 * Why one thing: the control and the peer source both take a lazy `transports()` thunk so they can exist
 * before any transport does (a phone builds mDNS seconds into boot). Until 2026-08-30 the mobile shell
 * created its own pair over its own thunk and threw away the pair `buildMeshTransports` made over the
 * real transports — two controls for one radio, and the one the screen held was the one nobody re-asked
 * when the transport arrived ("unavailable" for as long as the tab stayed open). The web shell used the
 * builder's. So: the app creates the surface, hands it to the builder, and the builder fills it in
 * (`setTransports`) — which settles the control (re-applies what a screen asked meanwhile) and rebinds
 * the peer source. One object, both shells, no duplicate.
 *
 * @param {object} [opts]
 * @param {(report: object) => void} [opts.onDegraded]  forwarded to the control
 * THE LAN KEY is a property of the surface too (`setLanIdentity`): what a LAN transport says on the network is a
 * room key while a room is open and a rest key otherwise, and an app asks for that here, never of the transport. A key
 * asked for before the transport lands is applied when it lands.
 *
 * @returns {{ discoverability, nearbyPeers, transports: () => object, setTransports: (next: object) => Promise<void>,
 *   setLanIdentity: (identity: object|null) => Promise<string|null>, lanAddress: () => string|null }}
 */
export function createMeshSurface({ onDegraded = null } = {}) {
  let current = {};
  let lanIdentity = null;   // the room key asked for; null = a rest key
  const lanTransports = () => Object.values(current).filter((t) => typeof t?.useLanIdentity === 'function');
  const transports = () => current;
  const discoverability = createDiscoverabilityControl({ transports, onDegraded });
  const nearbyPeers = createNearbyPeerSource({ transports });
  return {
    discoverability,
    nearbyPeers,
    transports,
    /**
     * The transports landed (or changed). Re-read them everywhere: re-apply what the control was asked
     * while they were absent (or read what they do), and seed the peer list from whoever is connected.
     */
    async setTransports(next = {}) {
      current = Object.fromEntries(Object.entries(next ?? {}).filter(([, t]) => t));
      if (lanIdentity) for (const t of lanTransports()) { try { await t.useLanIdentity(lanIdentity); } catch { /* reported by the transport */ } }
      try { await discoverability.settle(); } catch { /* the control reports its own failures */ }
      try { nearbyPeers.rebind(); } catch { /* a peer source with no watchers has nothing to rebind */ }
    },
    /**
     * Speak on the LAN under `identity` (a room key) from now on, or with `null` under a fresh rest key. A key change
     * is a new presence: the LAN connections made under the old key end. Resolves to the LAN address now spoken (null
     * while no LAN transport is there; the key is applied when one lands).
     */
    async setLanIdentity(identity = null) {
      lanIdentity = identity ?? null;
      for (const t of lanTransports()) await t.useLanIdentity(lanIdentity);
      try { nearbyPeers.rebind(); } catch { /* nothing watching */ }
      return lanTransports()[0]?.lanAddress ?? null;
    },
    /** The key the LAN transport speaks right now, or null. */
    lanAddress() { return lanTransports()[0]?.lanAddress ?? null; },
  };
}
