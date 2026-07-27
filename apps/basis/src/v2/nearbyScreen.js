/**
 * basis v2 — the Nearby screen CONTROLLER (Nearby step E).
 *
 * Four things already exist and each does one job: `buildNearbyModel` projects peers into rows,
 * `nearbyActions` decides what a row may offer, `createProximitySession` owns the advertise-while-open
 * lifecycle, and `createNetworkChangeWatcher` re-announces after a Wi-Fi switch. What was missing is the
 * thing that COMPOSES them.
 *
 * It has to live here rather than in each shell. Composition is logic — which order to open in, what to do
 * when the surface disagrees with the request, when to stop watching — and a shell that hand-rolled it
 * would be the fifth place this repo has grown a second copy of a rule (invariant 1). Web and mobile get
 * the same brain and differ only in how they draw it (invariant 2).
 *
 * ── What the screen is responsible for that the parts are not ────────────────────────────────────────────
 *
 *   • **Saying what the device is actually doing.** The session knows what it ASKED for; only the surface
 *     knows what happened. On an older Android binary "ghost mode" is still advertising, so the screen
 *     shows `visibility()` from the surface report — never `session.isAdvertising()` alone.
 *   • **Refusing to let proximity imply access.** Every row's actions come from `nearbyActions`, which
 *     answers membership from the ROSTER. Being on the same Wi-Fi is not a relationship (rule b).
 *   • **Closing properly.** Leaving the screen must stop advertising, stop watching, and drop the peer
 *     list — in that order, and even if the caller never opened it.
 */
import { buildNearbyModel, }             from './circleNearby.js';
import { createProximitySession, nearbyActions } from './circleProximity.js';
import { makeNearbySessionAdapter }      from './nearbyDiscoverability.js';
import { createNetworkChangeWatcher }    from './networkChangeWatcher.js';

/**
 * @param {object} deps
 * @param {object} [deps.control]        the discoverability control (`createDiscoverabilityControl`)
 * @param {(onPeers: (peers: object[]) => void) => (() => void)} [deps.subscribeToPeers]
 * @param {(onEvent: () => void) => (() => void)} [deps.subscribeToNetwork]  platform network source
 * @param {() => Array} [deps.mySkills]  published skills, read at render time
 * @param {string} [deps.myPseudonym]
 * @param {(peerId: string) => boolean} [deps.isKnownMember]  the ROSTER answer, never proximity
 * @param {() => boolean} [deps.canInvite]
 * @param {string} [deps.restingState]   passed through to the session adapter
 * @param {function} [deps.t]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 * @returns {{open, close, isOpen, model, actionsFor, visibility, subscribe, refresh}}
 */
export function createNearbyScreen({
  control = null,
  subscribeToPeers = null,
  subscribeToNetwork = null,
  mySkills = () => [],
  myPseudonym = null,
  isKnownMember = () => false,
  canInvite = () => false,
  restingState,
  t,
  onError = null,
} = {}) {
  const watchers = new Set();

  const adapter = makeNearbySessionAdapter({
    control, restingState, onError,
    // A degradation is not an error and must not be swallowed either: the screen re-renders so the
    // visibility line can change from "hidden" to "still visible" the moment the transports say so.
    onDegraded: () => emit(),
  });

  const session = createProximitySession({
    startAdvertising: adapter.startAdvertising,
    stopAdvertising:  adapter.stopAdvertising,
    subscribe:        subscribeToPeers ?? undefined,
    onError,
  });

  const watcher = createNetworkChangeWatcher({
    subscribe: subscribeToNetwork ?? undefined,
    onChange:  () => { adapter.onNetworkChange(); emit(); },
    onError,
  });

  session.subscribeToPeers(() => emit());

  function emit() {
    const snapshot = model();
    for (const w of watchers) { try { w(snapshot); } catch { /* one bad watcher */ } }
  }

  /**
   * What the device is ACTUALLY doing, in terms a screen can render.
   *
   * `requested` and `effective` are both reported because they disagree in exactly the case a user needs
   * told about: asked to be hidden, still being announced.
   */
  function visibility() {
    const report = adapter.lastReport();
    const effective = report?.effective ?? 'off';
    return {
      requested:  report?.requested ?? 'off',
      effective,
      publishing: effective === 'browse+publish',
      // TRUE only when we asked to be hidden and are not. This is the one that earns a warning in the UI.
      degraded:   report?.degraded === true,
      // The device simply cannot discover (no radio, no permission). Not a warning — an explanation.
      unavailable: report?.shortfall === true && effective === 'off',
      perTransport: report?.perTransport ?? [],
    };
  }

  /**
   * A roster that cannot answer means NOT a member.
   *
   * Deny-by-default, and it also keeps the screen alive: letting the throw escape would blank the whole
   * list because one lookup failed, which is a worse outcome than showing strangers as strangers.
   */
  function safeIsKnownMember(peerId) {
    try { return !!isKnownMember(peerId); }
    catch (err) { try { onError?.(err, 'isKnownMember'); } catch { /* diagnostics only */ } return false; }
  }

  function model() {
    const built = buildNearbyModel({
      peers: session.peers(),
      mySkills: safeCall(mySkills, []),
      myPseudonym,
      t,
    });
    // Actions are attached per row rather than computed in the renderer, so web and mobile cannot drift on
    // what proximity entitles someone to.
    const rows = built.rows.map((row) => ({
      ...row,
      ...nearbyActions(row, { isKnownMember: safeIsKnownMember, canInvite: !!safeCall(canInvite, false) }),
    }));
    return { ...built, rows, visibility: visibility(), isOpen: session.isOpen() };
  }

  return {
    /** Enter the screen: announce, listen for peers, watch for network changes. */
    open() {
      session.open();      // advertising + peer subscription
      watcher.start();     // only while the screen is up: a closed screen has nothing to re-announce for
      emit();
    },

    /**
     * Leave the screen. Safe without a matching `open()`, and safe twice — teardown paths are unreliable,
     * and the one thing that must not survive is the advertising.
     */
    close() {
      watcher.stop();
      session.close();
      emit();
    },

    isOpen: () => session.isOpen(),
    model,
    visibility,

    /** Actions for one row id, for a host that renders rows itself. */
    actionsFor(rowId) {
      const row = model().rows.find((r) => r.id === rowId) ?? null;
      return row ? { actions: row.actions, isMember: row.isMember, note: row.note } : null;
    },

    /** Re-render on demand (a skill published, a roster change). */
    refresh: emit,

    /** Watch the model; returns an unsubscribe. */
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
  };
}

function safeCall(fn, fallback) {
  try { return typeof fn === 'function' ? fn() : fn ?? fallback; }
  catch { return fallback; }
}
