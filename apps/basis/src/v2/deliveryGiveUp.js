/**
 * basis v2 — the two ways a message is GIVEN UP ON, and what the bubble should say when it happens.
 *
 * Two different facts, deliberately reported by two hooks, and both ending at the same honest state:
 *
 *   • `onHoldDropped`  — it never left this device. The local hold queue kept it for a peer that never
 *                        came back, hit its TTL or a cap, and let it go.
 *   • `onUndelivered`  — it DID leave. It waited at the relay, and the relay's TTL or a cap ended it.
 *
 * Both mean "this did not arrive". Only the first means "we never sent it", which is why they stay
 * distinct at the source even though they agree here — a retry path needs to know which happened.
 *
 * ── Why this is shared code and not two lines in each shell ──────────────────────────────────────────
 * It WAS two lines in one shell. Mobile consumed both hooks from 2026-07-31; web consumed neither, so on
 * web a message the system had given up on kept its optimistic state indefinitely. Nobody noticed because
 * nothing fails when a report has no listener — the message simply keeps looking fine.
 *
 * That is the repo's most-repeated defect (invariant 2: an empty grep on the other shell is a FINDING),
 * and it matters more here than usual: web is the surface we are shipping first, so the shell that could
 * not say what happened to your message was the one people were going to use.
 *
 * The shells inject their delivery map and their logger; the rule lives once.
 */

/** The state a given-up message lands in. Terminal, and the bubble already renders it with a retry. */
const GAVE_UP = 'failed';

/**
 * Build the two give-up consumers over a delivery-state map.
 *
 * @param {object} a
 * @param {{set: (msgId: string, state: string) => void}} a.deliveryMap
 * @param {(message: string) => void} [a.onWarn]  defaults to console.warn
 * @returns {{onHoldDropped: Function, onUndelivered: Function}}
 */
export function makeGiveUpConsumers({ deliveryMap, onWarn = null } = {}) {
  const warn = typeof onWarn === 'function' ? onWarn : (m) => console.warn(m);

  /** Mark, then report. The mark is what the person sees; the log is for us. */
  const giveUp = (msgId, line) => {
    if (!msgId) return;
    // A map that throws must not take the reporting path down with it — the warn below is then the only
    // record that anything happened, which is exactly when it is most needed.
    try { deliveryMap?.set?.(msgId, GAVE_UP); } catch { /* reported below regardless */ }
    warn(line);
  };

  return {
    /** It never left this device. */
    onHoldDropped: ({ msgId, reason, addr, ageMs } = {}) => giveUp(
      msgId,
      `[delivery] gave up on ${String(msgId)} → ${String(addr ?? '?').slice(0, 16)}… `
      + `(${reason}${Number.isFinite(ageMs) ? `, held ${Math.round(ageMs / 1000)}s` : ''})`,
    ),

    /** It left, waited at the relay, and the relay gave up. */
    onUndelivered: ({ msgId, reason } = {}) => giveUp(
      msgId,
      `[delivery] relay gave up on ${String(msgId)} (${reason ?? 'unknown'})`,
    ),
  };
}
