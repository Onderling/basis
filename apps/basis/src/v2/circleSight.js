/**
 * A CIRCLE OUT OF SIGHT (opbergen, Frits 2026-09-24; Fable's shape, `NOTE-delete-contacts-and-circles.md` §6b) —
 * ONE fact with three values:
 *
 *   • shown               — the default;
 *   • put away            — the PERSON's mark (`setCircleSight`): out of their list on every device, and it wakes
 *                           nobody. Kept on the circle's registry record, carried to their other devices, newest wins;
 *                           taking it out again is the same act. No auto-return — unlike a contact, a circle does not
 *                           come back by itself.
 *   • not on this device  — the kring opt-out (`syncSelection.kringOn`): the DEVICE's own value of the same fact,
 *                           set on My data. It wins on this device over the person's mark: this device does not hold
 *                           the circle at all.
 *
 * Never a circle statement: the roster does not need to know who put a circle away. "Wakes nobody" is the rule the
 * notification gate reads when there is one (none exists yet — see `eventLog.shouldWakeForEntry`); today the fold is
 * what a person sees.
 */
export const SIGHT = Object.freeze({ shown: 'shown', putAway: 'put-away', notHere: 'not-on-this-device' });

/**
 * @param {string} circleId
 * @param {{ sights?: Record<string, {putAway: boolean, at: number}>, kringOn?: (id: string) => boolean }} [a]
 */
export function circleSightOf(circleId, { sights = {}, kringOn = () => true } = {}) {
  let here = true;
  try { here = kringOn(circleId) !== false; } catch { here = true; }
  if (!here) return SIGHT.notHere;
  return sights?.[circleId]?.putAway === true ? SIGHT.putAway : SIGHT.shown;
}

/** The launcher's list split: `shown` in its order, `folded` (each with its `sight`) in its order. */
export function splitBySight(circles, opts = {}) {
  const shown = []; const folded = [];
  for (const c of circles ?? []) {
    const sight = circleSightOf(c?.id, opts);
    if (sight === SIGHT.shown) shown.push(c); else folded.push({ ...c, sight });
  }
  return { shown, folded };
}
