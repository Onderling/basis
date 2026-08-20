/**
 * THE delivery-state vocabulary + the per-message state map — ONE home (the substrate-audit's single
 * real extraction, 2026-08-20). The ladder used to live in `apps/basis/src/v2/deliveryState.js` while
 * this package hardcoded its own copy of the states — two layers holding the same fact, and they had
 * already diverged (this file's typedef still documented states the app had retired). The vocabulary
 * now lives HERE, where the package that needs it may import it and the app re-exports it; the
 * duplicate-vocab guard registers this home so a second frozen copy fails CI.
 *
 * ── The ladder (G8/G9/G10, decided 2026-07-28; decision 1, 2026-07-29) ──────────────────────────────
 *
 * Every rung is named for what it PROVES rather than for how it feels:
 *
 *   pending         the fan-out is in flight.
 *   maybe-received  it left this device and nobody confirmed anything. It MAY have arrived and the
 *                   confirmation may have been lost — genuinely unknown. (Frits' word, and the right
 *                   one: "sent" over-claims here and "failed" under-claims.)
 *   stored          their APP accepted and stored it — the strongest claim we make, and the only
 *                   positive evidence admitted: a receipt the recipient CHOSE to send.
 *
 * Two states were RETIRED (decision 1): `sent` read as success while meaning only "the fan-out
 * accepted it"; `reached-device` is the transport ack, deliberately never shown — a phone acks
 * whatever its owner's receipt setting says, so surfacing it would identify a receipts-off peer by
 * where their ladder stops.
 *
 * The terminal negatives sit OUTSIDE the ladder — they are where a message stopped, not how far it
 * got: `failed` (the send did not go; retryable) and `undeliverable` (no address at all).
 *
 * ── Two rules that are easy to get wrong ────────────────────────────────────────────────────────────
 *
 * **1. The ladder only goes up.** Acks and receipts arrive out of order, and a late transport-ack
 * after an app-receipt must not demote a message. `advanceDelivery` enforces that — with ONE
 * deliberate exception from the shipped flow: `pending` may leave a terminal state, because a RETRY
 * is an act, not an arrival.
 *
 * **2. There is NO state meaning "they turned receipts off."** Receipts are disableable for privacy,
 * and a state that said so would broadcast the setting to everyone who messages you. Absence stays
 * ambiguous; `deliveryStates()` is asserted against that in the tests.
 *
 * There is deliberately no read receipt. Frits: *"reading confirmation is not important now."*
 */

export const DELIVERY = Object.freeze({
  PENDING: 'pending',
  FAILED: 'failed',
  UNDELIVERABLE: 'undeliverable',
  MAYBE: 'maybe-received',
  STORED: 'stored',
});

/** The terminal negatives. Not on the ladder: they are where a message stopped, not how far it got. */
export const DELIVERY_TERMINAL = Object.freeze([DELIVERY.FAILED, DELIVERY.UNDELIVERABLE]);

/** Ordered weakest → strongest. The order IS the semantics; see rule 1. */
export const DELIVERY_ORDER = Object.freeze([
  DELIVERY.PENDING, DELIVERY.MAYBE, DELIVERY.STORED,
]);

/** The states that exist. Exported so a test can assert nothing was added that leaks a setting. */
export function deliveryStates() { return [...DELIVERY_ORDER]; }

export function isDeliveryState(v) {
  return DELIVERY_ORDER.includes(v) || DELIVERY_TERMINAL.includes(v);
}

/**
 * Move a message's state forward, never back.
 *
 * Out-of-order arrival is normal, not exceptional: the app receipt travels the same unreliable network
 * as the transport ack and can overtake it. Taking the max is the only rule that survives that.
 */
export function advanceDelivery(current, next) {
  // A terminal state is where a message STOPPED, so it is not compared on the ladder: it replaces
  // whatever came before, and a stale ack must not resurrect a message the user was told did not go.
  //
  // ONE exception, and it comes from the shipped flow rather than from theory: `pending → failed →
  // (retry) pending → …`. A retry is an ACT, not an arrival, so `pending` is allowed out of a terminal
  // state and nothing else is.
  if (DELIVERY_TERMINAL.includes(current)) return next === DELIVERY.PENDING ? next : current;
  if (DELIVERY_TERMINAL.includes(next)) return next;

  const a = DELIVERY_ORDER.indexOf(current);
  const b = DELIVERY_ORDER.indexOf(next);
  if (b < 0) return isDeliveryState(current) ? current : DELIVERY.PENDING;
  if (a < 0) return next;
  return b > a ? next : current;
}

/**
 * @typedef {'pending'|'maybe-received'|'stored'|'failed'|'undeliverable'|null} DeliveryState
 */

/**
 * @typedef {object} DeliveryStateMap
 * @property {(msgId: string) => DeliveryState} get
 *   Returns the current state for `msgId`, or `null` if not tracked.
 * @property {(msgId: string, state: DeliveryState) => void} set
 *   Sets the state for `msgId` (through `advanceDelivery` — monotonic).  Pass `null` (or `undefined`)
 *   to clear the entry — useful so the map doesn't grow unbounded as sent messages accumulate.
 *   Notifies subscribers either way.
 * @property {(msgId: string) => boolean} clear
 *   Convenience: equivalent to `set(msgId, null)`.  Returns `true` if an entry was actually removed.
 * @property {() => number} pruneUnconfirmed
 *   Drop every unconfirmed (`maybe-received`) entry — keeps a long-lived map from accumulating them.
 *   Subscribers receive one `(msgId, null)` notification per cleared entry; returns the count.
 * @property {() => number} size
 *   Number of tracked entries (post-clear).
 * @property {(fn: (msgId: string, state: DeliveryState) => void) => () => void} subscribe
 *   Register a listener.  Returns an unsubscribe handle.
 */

/**
 * Factory.  One map per agent boot — instantiated alongside the EventLog so its lifetime matches the
 * in-memory event stream (rehydrated from the log at boot by `rehydrateDeliveryState` in basis).
 *
 * @returns {DeliveryStateMap}
 */
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
      if (!isDeliveryState(state)) return;
      // Monotonic through the ONE rule (`advanceDelivery`) — the map no longer carries its own copy of
      // the ladder, so it cannot drift from the vocabulary again.
      const current = map.get(msgId);
      const next = advanceDelivery(current, state);
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
    /**
     * Drop the entries that never got confirmed, so a long-lived map does not accumulate them.
     * (The resting state for an unconfirmed message is `maybe-received`. No production caller yet —
     * worth knowing before relying on it.)
     */
    pruneUnconfirmed() {
      // Collect IDs first so we don't mutate the Map while iterating.
      const toClear = [];
      for (const [id, st] of map.entries()) {
        if (st === DELIVERY.MAYBE) toClear.push(id);
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
