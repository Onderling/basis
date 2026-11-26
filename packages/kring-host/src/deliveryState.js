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
/** The states a reason may sit beside: a failure, and a wait the person can act on. */
const REASON_STATES = Object.freeze([...DELIVERY_TERMINAL, DELIVERY.PENDING]);

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
  // WHY a send failed or waits, when the fan knew (`fanOutReason`) — beside the state, never a state of its own, and only
  // beside a failure or a wait (`pending`: held here for a reason the person can act on); a state that moves on (a retry,
  // the held message going out, a receipt) drops it.
  /** @type {Map<string, string>} */
  const reasons = new Map();
  // WHO A LINE STILL WAITS FOR — a side fact beside the state, never a rung (the ladder says what is PROVEN, this says
  // who still waits for an address): `{ sent, of }` while a circle line was sent to `sent` of its `of` recipients and
  // the rest wait; null once nobody waits. `sent` counts sends (an address was known), never receipts — a count of
  // receipts would show who has receipts off. Fed by the log (`rehydrateDeliveryState` follows it).
  /** @type {Map<string, {sent: number, of: number}>} */
  const waiting = new Map();
  // THE RELAY GAVE UP ON IT: a side fact beside the state, never a rung and never a reason (docs/decisions.md 2026-07-29,
  // "The delivery ladder admits doubt", its addition of 2026-11-26). A relay's give-up (its TTL, a cap, an over-rate
  // give-up) is the relay's word, not this device's knowledge, so it may offer a retry but never moves the ladder: the
  // bubble keeps its rung and gets a hint beside it. This device's own view only: never synced, never logged. It clears
  // when the state moves on (a real receipt) and when the person retries (a `pending` set with no reason: an act).
  /** @type {Map<string, string>} */
  const relayGaveUp = new Map();
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
    set(msgId, state, { reason = null } = {}) {
      if (typeof msgId !== 'string' || msgId === '') return;
      if (state == null) {
        reasons.delete(msgId);
        relayGaveUp.delete(msgId);
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
      const reasonBefore = reasons.get(msgId) ?? null;
      if (REASON_STATES.includes(next) && typeof reason === 'string' && reason) reasons.set(msgId, reason);
      else if (next !== current) reasons.delete(msgId);
      // the relay's give-up hint goes when the state moves on, or when the person retries (a reasonless `pending`; the
      // app map's own waiting timer always names a reason, so it never clears the hint)
      const hintGone = relayGaveUp.has(msgId) && (next !== current || (state === DELIVERY.PENDING && !reason))
        && relayGaveUp.delete(msgId);
      // the same state with a new reason, or without the hint, is news too: the words a screen shows come from them
      if (next === current) { if (hintGone || (reasons.get(msgId) ?? null) !== reasonBefore) notify(msgId, next); return; }
      map.set(msgId, next);
      notify(msgId, next);
    },
    /** Who a line still waits for, `{ sent, of }`, or null (see above). Notifies when it changes. */
    setWaiting(msgId, w = null) {
      if (typeof msgId !== 'string' || msgId === '') return;
      const before = waiting.get(msgId) ?? null;
      const next = w && Number.isFinite(w.sent) && Number.isFinite(w.of) && w.of > 0 ? { sent: w.sent, of: w.of } : null;
      if ((before?.sent ?? null) === (next?.sent ?? null) && (before?.of ?? null) === (next?.of ?? null)) return;
      if (next) waiting.set(msgId, next); else waiting.delete(msgId);
      notify(msgId, map.get(msgId) ?? null);
    },
    waitingOf(msgId) {
      return (typeof msgId === 'string' && waiting.get(msgId)) || null;
    },
    /**
     * The relay gave up on a message this map knows (see above): `reason` is the relay's word ('expired', 'over-rate',
     * …), null clears it. Ignored for a message the map does not know (lane traffic has no bubble) and for one already
     * `stored` (a receipt outranks a relay's word). Notifies when it changes.
     */
    setRelayGaveUp(msgId, reason = null) {
      if (typeof msgId !== 'string' || msgId === '') return;
      const before = relayGaveUp.get(msgId) ?? null;
      const state = map.get(msgId) ?? null;
      const next = reason == null || state == null || state === DELIVERY.STORED ? null : (String(reason) || 'unknown');
      if (before === next) return;
      if (next) relayGaveUp.set(msgId, next); else relayGaveUp.delete(msgId);
      notify(msgId, state);
    },
    /** The relay's give-up reason beside this message, or null. */
    relayGaveUpOf(msgId) {
      return (typeof msgId === 'string' && relayGaveUp.get(msgId)) || null;
    },
    /** The reason beside a failed/undeliverable/pending state, or null. */
    reasonOf(msgId) {
      return (typeof msgId === 'string' && reasons.get(msgId)) || null;
    },
    clear(msgId) {
      if (typeof msgId !== 'string' || msgId === '') return false;
      reasons.delete(msgId);
      waiting.delete(msgId);
      relayGaveUp.delete(msgId);
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
        relayGaveUp.delete(id);
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
