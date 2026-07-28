/**
 * basis v2 — per-message delivery state (δ.2).
 *
 * The kring chat send is optimistic: the local user's message is
 * appended to the in-memory EventLog the moment the composer fires,
 * then a best-effort `broadcastKringMessage` fan-out runs in the
 * background.  Before δ.2, failures were silent — the user never
 * knew if their message reached peers.
 *
 * δ.2 keeps a SIBLING map (keyed by `msgId`) of one of:
 *   - `'pending'`  — fan-out in flight; bubble shows a clock icon
 *   - `'sent'`     — fan-out resolved with no errors; bubble shows nothing (happy-path stays clean)
 *   - `'failed'`   — fan-out rejected or returned `errors[]`; bubble shows a warning that taps to retry
 *
 * **Extended 2026-07-28 (G8/G9/G10)** with the far end of the same journey — what happened on the PEER's
 * side, which δ.2 had no way to know:
 *   - `'maybe-received'`  — we asked for a transport ack, got none, and sent it fire-and-forget anyway
 *   - `'reached-device'`  — their transport acknowledged (before their app saw it)
 *   - `'stored'`          — their app accepted and stored it
 *
 * One map, not two. `apps/basis/src/v2/deliveryState.js` owns the ladder and its ordering; this owns the
 * per-message storage and the subscription. Splitting them across two maps was the near-miss that produced
 * `docs/conventions/shared-vocabularies.md`.
 *
 * The EventLog stays append-only.  This map is a separate piece of
 * UI state read at render time and re-fired when state flips.
 *
 * Subscribers receive `(msgId, state)` where `state` is the new value
 * (or `null` when the entry was cleared).
 *
 * Platform: neutral (plain JS).  Used by both web (circleApp.js) and
 * mobile (CircleLauncherScreen.js) kring chat send paths.
 */

/**
 * @typedef {'pending'|'sent'|'maybe-received'|'reached-device'|'stored'|'failed'|'undeliverable'|null} DeliveryState
 */

/**
 * @typedef {object} DeliveryStateMap
 * @property {(msgId: string) => DeliveryState} get
 *   Returns the current state for `msgId`, or `null` if not tracked.
 * @property {(msgId: string, state: DeliveryState) => void} set
 *   Sets the state for `msgId`.  Pass `null` (or `undefined`) to
 *   clear the entry — useful so the map doesn't grow unbounded as
 *   sent messages accumulate.  Notifies subscribers either way.
 * @property {(msgId: string) => boolean} clear
 *   Convenience: equivalent to `set(msgId, null)`.  Returns `true`
 *   if an entry was actually removed.
 * @property {() => number} pruneSent
 *   Drop every `'sent'` entry from the map.  Renderers treat `'sent'`
 *   and `null` identically (no icon either way), so this is invisible
 *   to the UI — its purpose is to keep the in-memory map from growing
 *   unbounded over a long session of heavy chat.  Subscribers receive
 *   one `(msgId, null)` notification per cleared entry.  Returns the
 *   number of entries pruned.  Callers wire this on whatever cadence
 *   makes sense (e.g. a `setInterval`, an EventLog prune hook, or
 *   on-demand from the chat-shell).  Not auto-wired by the substrate
 *   because the map dies with the agent boot anyway — growth is
 *   bounded by session length even without pruning.
 * @property {() => number} size
 *   Number of tracked entries (post-clear).
 * @property {(fn: (msgId: string, state: DeliveryState) => void) => () => void} subscribe
 *   Register a listener.  Returns an unsubscribe handle.
 */

/**
 * Factory.  One map per agent boot — instantiated alongside the
 * EventLog so its lifetime matches the in-memory event stream.
 *
 * @returns {DeliveryStateMap}
 */
/** The full ladder, weakest → strongest. Terminals sit outside it (see `advance`). */
const LADDER = ['pending', 'sent', 'maybe-received', 'reached-device', 'stored'];
const TERMINAL = new Set(['failed', 'undeliverable']);
const KNOWN_STATES = new Set([...LADDER, ...TERMINAL]);

/**
 * Forward-only, with one deliberate exception.
 *
 * From a TERMINAL state (`failed` / `undeliverable`) the only move allowed is back to `pending` — a RETRY,
 * which is an act by the user or the app, not a message arriving. Everything else is ignored, so a late
 * transport-ack cannot quietly un-fail a message the user was already told did not send.
 *
 * That exception is not hypothetical: the existing flow is `pending → failed → (retry) pending → sent`, and
 * a test has pinned it since δ.2. Making terminals fully absorbing broke it — which is the second time
 * today that reading what already exists changed the design rather than confirming it.
 */
function advance(current, next) {
  if (current == null) return next;
  if (TERMINAL.has(current)) return next === 'pending' ? next : current;
  if (TERMINAL.has(next)) return next;
  const a = LADDER.indexOf(current);
  const b = LADDER.indexOf(next);
  return b > a ? next : current;
}

export function createDeliveryStateMap() {
  /** @type {Map<string, Exclude<DeliveryState, null>>} */
  const map = new Map();
  /** @type {Set<(msgId: string, state: DeliveryState) => void>} */
  const subs = new Set();

  function notify(msgId, state) {
    for (const fn of subs) {
      try { fn(msgId, state); } catch { /* swallow */ }
    }
  }

  return {
    get(msgId) {
      if (typeof msgId !== 'string' || msgId === '') return null;
      return map.has(msgId) ? map.get(msgId) : null;
    },
    set(msgId, state) {
      if (typeof msgId !== 'string' || msgId === '') return;
      if (state == null) {
        if (!map.has(msgId)) return;
        map.delete(msgId);
        notify(msgId, null);
        return;
      }
      if (!KNOWN_STATES.has(state)) return;
      // Monotonic: acks and receipts race, and a late transport-ack must not demote a message the app
      // receipt already advanced. A TERMINAL state (failed/undeliverable) replaces whatever came before and
      // is never itself replaced — the user was told it did not go, and a stale ack must not rewrite that.
      const current = map.get(msgId);
      const next = advance(current, state);
      if (next === current) return;
      map.set(msgId, next);
      notify(msgId, next);
    },
    clear(msgId) {
      if (typeof msgId !== 'string' || msgId === '') return false;
      if (!map.has(msgId)) return false;
      map.delete(msgId);
      notify(msgId, null);
      return true;
    },
    pruneSent() {
      // Collect IDs first so we don't mutate the Map while iterating.
      const toClear = [];
      for (const [id, st] of map.entries()) {
        if (st === 'sent') toClear.push(id);
      }
      for (const id of toClear) {
        map.delete(id);
        notify(id, null);
      }
      return toClear.length;
    },
    size() { return map.size; },
    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}
