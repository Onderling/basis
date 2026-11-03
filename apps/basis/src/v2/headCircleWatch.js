/**
 * A head hears of a circle it does not know yet.
 *
 * Vandaag's and Mij's heads (`screenHead.js`) re-read when a circle's items change, over the circle list the shell
 * holds. A circle that arrives while the page is shown — joined on another device, through an offer, made by an op —
 * changes items in a circle that list does not hold yet, so the head re-read without it and the new circle's items
 * stayed off the page until a reload. Here the list is re-read FIRST, then the head hears the change.
 *
 * @param {object} a
 * @param {(fn: (circleId: string, meta?: object) => void) => (() => void)} a.onCircleChanged  the agent's change feed
 * @param {(circleId: string) => boolean} a.knows    does the shell's circle list hold this circle?
 * @param {() => Promise<any>} a.refresh             re-read the shell's circle list
 * @returns {(fn: (circleId: string, meta?: object) => void) => (() => void)}  a subscribe for `createScreenHead`
 */
export function watchCircleChanges({ onCircleChanged, knows, refresh }) {
  return (fn) => onCircleChanged((circleId, meta) => {
    let known = true;
    try { known = !circleId || knows(circleId) !== false; } catch { known = true; }
    if (known) { fn(circleId, meta); return; }
    Promise.resolve().then(() => refresh()).catch(() => { /* the head hears it regardless */ }).then(() => fn(circleId, meta));
  });
}
