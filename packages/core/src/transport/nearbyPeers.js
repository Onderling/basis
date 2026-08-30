/**
 * NEARBY PEERS — the surface answer to "who is around right now".
 *
 * The rule that produced this file (`CLAUDE.md`): *go through the surface, never the transport.* The Nearby
 * screen was reading `bundle.mdns.peers` — reaching past the mesh builder into one adapter, which meant it
 * saw mDNS and was blind to BLE, and would have needed a second special case the day a third discovering
 * transport appeared. Reaching for a transport is the signal that the surface is missing an affordance, so
 * here it is, beside `discoverability` and shaped the same way: one control, every discovering transport.
 *
 * ── Why merging is not just concatenation ────────────────────────────────────────────────────────────────
 * The same person can be found twice — once over Wi-Fi and once over BLE — and they are one row, not two.
 * So peers are keyed by address, and a second sighting UPDATES rather than appends, keeping every source it
 * was seen on. A screen that showed "Ada" twice because she has two radios would be reporting our plumbing
 * as if it were the room.
 *
 * `lastSeen` is caller-supplied (`now`) rather than read from the clock here, so a host can drive it
 * deterministically and tests do not depend on wall time.
 */

/**
 * @param {object} deps
 * @param {() => Record<string, object|null>} deps.transports  named transports; re-read on subscribe
 * @param {() => number} [deps.now]
 * @returns {{subscribe, list, rebind, forget, close}}
 */
export function createNearbyPeerSource({ transports, now = () => Date.now() } = {}) {
  if (typeof transports !== 'function') {
    throw new TypeError('createNearbyPeerSource: `transports` must be a function returning named transports');
  }

  /** address → { pubKey, sources:Set<string>, firstSeen, lastSeen } */
  const peers = new Map();
  const watchers = new Set();
  let bound = [];

  const snapshot = () => [...peers.values()].map((p) => ({
    pubKey: p.pubKey,
    sources: [...p.sources],
    // `source` (singular) is what `buildNearbyModel` reads. The FIRST source is the one reported, so a peer
    // does not flicker between labels as radios come and go.
    source: p.sources.values().next().value ?? 'unknown',
    firstSeen: p.firstSeen,
    lastSeen: p.lastSeen,
  }));

  const emit = () => {
    const rows = snapshot();
    for (const w of watchers) { try { w(rows); } catch { /* one bad watcher must not stop the rest */ } }
  };

  function seen(address, source) {
    if (typeof address !== 'string' || !address) return;
    const at = now();
    const existing = peers.get(address);
    if (existing) {
      existing.sources.add(source);
      existing.lastSeen = at;
    } else {
      peers.set(address, { pubKey: address, sources: new Set([source]), firstSeen: at, lastSeen: at });
    }
    emit();
  }

  function lost(address, source) {
    const existing = peers.get(address);
    if (!existing) return;
    existing.sources.delete(source);
    // Only gone when EVERY transport has lost them. Dropping the row when one radio disconnects would make
    // someone standing right there vanish because Wi-Fi blipped, while BLE still had them.
    if (existing.sources.size === 0) peers.delete(address);
    else existing.lastSeen = now();
    emit();
  }

  function unbind() {
    for (const { transport, onFound, onLost } of bound) {
      try { transport.off?.('peer-discovered', onFound); } catch { /* best-effort */ }
      try { transport.off?.('peer-disconnected', onLost); } catch { /* best-effort */ }
    }
    bound = [];
  }

  function bind() {
    unbind();
    for (const [name, t] of Object.entries(transports() ?? {})) {
      if (!t || typeof t.on !== 'function') continue;
      const onFound = (address) => seen(address, name);
      const onLost  = (address) => lost(address, name);
      t.on('peer-discovered', onFound);
      t.on('peer-disconnected', onLost);
      bound.push({ transport: t, onFound, onLost });
      // Seed with whoever the transport already holds: `peer-discovered` fired before we listened (the
      // screen opened after the handshake), and an event nobody heard must not mean an empty room.
      let already = [];
      try { already = t.connectedPeers?.() ?? []; } catch { /* a transport that cannot say is just empty */ }
      for (const address of already) seen(address, name);
    }
  }

  return {
    /**
     * Watch the merged peer list; returns an unsubscribe.
     *
     * Binding happens on the FIRST subscriber and unbinding on the last, so a closed Nearby screen is not
     * quietly accumulating a list of everyone who walked past.
     */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      const first = watchers.size === 0;
      watchers.add(fn);
      if (first) bind();
      try { fn(snapshot()); } catch { /* deliver current state immediately */ }
      return () => {
        watchers.delete(fn);
        if (watchers.size === 0) { unbind(); peers.clear(); }
      };
    },

    /** The merged list, right now. */
    list: snapshot,
    /**
     * The set of transports changed (one landed after the first subscriber bound — a phone's mDNS is built
     * seconds into boot). Re-read them and seed; a no-op with nobody watching, since `subscribe` binds.
     */
    rebind() {
      if (watchers.size === 0) return;
      bind();
      emit();
    },

    /** Drop a peer entirely (a host that knows they are gone — a failed send, a block). */
    forget(address) {
      if (peers.delete(address)) emit();
    },

    /** Detach from every transport and drop the list. */
    close() { unbind(); peers.clear(); emit(); },
  };
}
