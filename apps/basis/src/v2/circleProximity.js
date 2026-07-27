/**
 * basis v2 — the lokale kring's proximity SESSION (the three rules, 2026-07-27).
 *
 * `circleNearby.js` renders who is around. This module owns *when we are discoverable* and *what being
 * nearby entitles anyone to* — the two halves that are privacy decisions rather than rendering.
 *
 * The three rules Frits settled (see `plans/PLAN-peer-connectivity.md` "Downstream consumers"):
 *
 *   (a) a proximity-discovery UX — the surface; lives in the shells.
 *   (b) **discovery ≠ membership** — a nearby device is NOT a member until it joins. Enforced here by
 *       `nearbyActions`, which never offers a membership affordance off the back of proximity alone.
 *   (c) **advertise only while the proximity view is open** — enforced here by `createProximitySession`.
 *
 * Rule (c) is the one that breaks silently. Broadcasting is invisible: navigate away, background the app,
 * hit an error mid-render, and a device that carries on announcing itself looks exactly like one that
 * stopped. So the session is a lifecycle object with one guarantee — **advertising is on if and only if the
 * session is open** — and it is written to hold that even when the caller is sloppy (double open, close
 * without open, an adapter that throws, a crash between the two).
 *
 * Pure + injectable: no DOM, no timers of its own, no transport import. The mDNS/BLE adapter is passed in,
 * so this is the same module on web and mobile (invariants 1/2) and testable without a network.
 */

/**
 * A proximity session — discoverable while open, silent while closed.
 *
 * @param {object} deps
 * @param {() => any} deps.startAdvertising  begin announcing this device (mDNS/BLE adapter)
 * @param {() => any} deps.stopAdvertising   stop announcing
 * @param {(onChange: (peers: object[]) => void) => (() => void)} [deps.subscribe]
 *   subscribe to the peer list; returns an unsubscribe. Absent ⇒ the session still governs advertising,
 *   it just never learns about peers (a host that polls instead can call `setPeers`).
 * @param {(err: Error, phase: string) => void} [deps.onError]  diagnostics; never throws onward
 * @returns {{open, close, isOpen, isAdvertising, peers, setPeers, subscribeToPeers}}
 */
export function createProximitySession({
  startAdvertising,
  stopAdvertising,
  subscribe = null,
  onError = null,
} = {}) {
  let open_ = false;
  let advertising = false;
  let unsubscribe = null;
  let peers = [];
  const watchers = new Set();

  const report = (err, phase) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } };
  const emit = () => { for (const w of watchers) { try { w(peers); } catch { /* one bad watcher */ } } };

  function setPeers(next) {
    // Only while open. A late callback from an adapter that has not finished tearing down must not
    // repopulate a closed session — otherwise "closed" would still show a live list.
    if (!open_) return;
    peers = Array.isArray(next) ? next.filter((p) => p && typeof p === 'object') : [];
    emit();
  }

  return {
    /**
     * Enter the proximity view: start advertising and listening. Idempotent — a second `open()` is a no-op
     * rather than a second advertisement (a re-render must not double-announce).
     */
    open() {
      if (open_) return;
      open_ = true;
      try {
        startAdvertising?.();
        advertising = true;
      } catch (err) {
        // Advertising failed (no mDNS module, Wi-Fi off, permission denied). Being UNDISCOVERABLE is the
        // safe failure: stay open so the user can still SEE others, but never claim we are announcing.
        advertising = false;
        report(err, 'start');
      }
      if (typeof subscribe === 'function') {
        try { unsubscribe = subscribe((next) => setPeers(next)) ?? null; }
        catch (err) { unsubscribe = null; report(err, 'subscribe'); }
      }
    },

    /**
     * Leave the view: stop advertising, stop listening, and DROP the peer list.
     *
     * The list is cleared deliberately. Keeping it would mean a closed session still holds who was around —
     * a small, quiet record of the places someone has been, which is exactly what rule (c) is about. Safe
     * to call without a matching `open()`, and safe to call twice: teardown paths are unreliable, so this
     * has to be the forgiving end.
     */
    close() {
      if (unsubscribe) {
        try { unsubscribe(); } catch (err) { report(err, 'unsubscribe'); }
        unsubscribe = null;
      }
      if (advertising) {
        // Even if stopping THROWS we mark ourselves not-advertising: a caller must never be told we are
        // still announcing when we have given up trying. The error is reported, not swallowed silently.
        try { stopAdvertising?.(); } catch (err) { report(err, 'stop'); }
        advertising = false;
      }
      open_ = false;
      peers = [];
      emit();
    },

    isOpen: () => open_,
    /** The load-bearing invariant: never true while closed. */
    isAdvertising: () => advertising && open_,
    peers: () => peers.slice(),
    setPeers,
    /** Watch the peer list; returns an unsubscribe. */
    subscribeToPeers(fn) {
      if (typeof fn !== 'function') return () => {};
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}

/**
 * What a nearby row may OFFER — rule (b), `discovery ≠ membership`.
 *
 * Being on the same Wi-Fi is not a relationship. A device you can see is a stranger you can see, so the
 * only affordances proximity earns are ones that START a consented exchange: invite them to a circle you
 * admin, or ask to join one of theirs. Never "open the circle", never "message", never anything that
 * implies you are already connected.
 *
 * @param {object} row               a `buildNearbyModel` row
 * @param {object} [ctx]
 * @param {(peerId: string) => boolean} [ctx.isKnownMember]  do we ALREADY share a circle with them?
 * @param {boolean} [ctx.canInvite]  does this user admin any circle they could invite into?
 * @returns {{actions: string[], isMember: boolean, note: string|null}}
 */
export function nearbyActions(row, { isKnownMember = () => false, canInvite = false } = {}) {
  const id = row?.id ?? null;
  // Membership is answered by the ROSTER, never inferred from the fact that we can see them. A device
  // being nearby says nothing about whether we know each other.
  const isMember = !!id && !!isKnownMember(id);

  const actions = [];
  if (canInvite) actions.push('invite-to-circle');
  actions.push('request-join');
  if (isMember) actions.push('open-shared-circle');   // ONLY because the roster said so

  return {
    actions,
    isMember,
    // The surface should say why a stranger is a stranger, rather than leaving proximity to imply access.
    note: isMember ? null : 'nearby-not-member',
  };
}
