import { DELIVERY, deliveryAfterSend } from './deliveryState.js';

/**
 * WHAT A TYPED TURN TO A CONTACT LEAVES ON ITS OWN BUBBLE, for both shells.
 *
 * A circle bubble has carried its delivery state since the fan-out landed on the shared ladder; a contact thread's own
 * bubble said nothing (a "versturen…" line under the list while the send ran, an error line when it threw, and silence
 * after). The two-phone walk found it (rows 9 and 11: "sent? delivered? waiting?"). Same ladder, same map, same chip:
 * `trackContactTurn` marks the turn `pending` the moment it is on screen and moves it when the addressed send answers.
 *
 * The answer is `addressedDeliver`'s: `{ sent: { delivered, held, reason }, fallback? }` — `fallback` is the plain send
 * to the person when the pair route reached nobody, and when it exists it is the verdict. The honesty rule is the
 * ladder's: a send that left is `maybe-received` (never "sent"), one that is held here is `pending` with its reason
 * beside it, one that did not leave is `failed` with its reason when the agent named one. A send with no verdict at
 * all (an injected sender answering nothing) is taken as left, as `addressedDeliver` itself takes it.
 *
 * @param {object|null|undefined} res   what `sendTurn().sent` resolved to
 * @returns {{ state: string, reason: string|null }}
 */
export function deliveryAfterContactSend(res) {
  const sent = res?.fallback ?? res?.sent ?? null;
  if (!sent || typeof sent !== 'object') return { state: deliveryAfterSend(), reason: null };
  if (sent.delivered === true) return { state: deliveryAfterSend(), reason: null };
  const reason = typeof sent.reason === 'string' && sent.reason ? sent.reason : null;
  if (sent.held === true) {
    // held on this device for a connection it does not have: a persona's own words when it is the persona's, else the plain wait
    return { state: DELIVERY.PENDING, reason: reason === 'persona-no-connection' ? 'persona-waiting' : 'held' };
  }
  if (sent.delivered === false) return { state: DELIVERY.FAILED, reason };
  return { state: deliveryAfterSend(), reason: null };
}

/**
 * Follow one typed turn on the shared delivery map: `pending` now, its outcome when the send answers, `failed` when
 * the send throws. The map's own monotonic rule orders a receipt that arrives first; a retry re-enters through the
 * same id. Resolves to the state written, so a caller may say a line only when the bubble cannot.
 *
 * @param {{ messageId: string, sent: Promise<any>, deliveryMap: {set:Function}|null }} turn
 * @returns {Promise<{ state: string|null, reason: string|null }>}
 */
export async function trackContactTurn({ messageId, sent, deliveryMap = null } = {}) {
  if (typeof messageId !== 'string' || !messageId) return { state: null, reason: null };
  const mark = (state, reason) => { try { deliveryMap?.set?.(messageId, state, reason ? { reason } : undefined); } catch { /* the map is a mirror */ } };
  mark(DELIVERY.PENDING, null);
  let outcome;
  let res = null;
  try { res = await sent; outcome = deliveryAfterContactSend(res); }
  catch { outcome = { state: DELIVERY.FAILED, reason: null }; }
  mark(outcome.state, outcome.reason);
  // HELD for an address this device does not know yet (the send gate): the hold ends later, sent or not sent, and the
  // bubble follows it, so it never says "waiting" for a message that will not go
  const held = res?.fallback ?? res?.sent ?? null;
  if (held?.held === true && held.later && typeof held.later.then === 'function') {
    let after;
    try { after = await held.later; } catch { after = { delivered: false, reason: null }; }
    outcome = deliveryAfterContactSend({ sent: after });
    mark(outcome.state, outcome.reason);
  }
  return outcome;
}
