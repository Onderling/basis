/**
 * timeSlice — give the thread back during long work, so a tap is never kept waiting behind it.
 *
 * On a phone a signature check in pure JavaScript costs about 60 ms; a read that checks several statements in a row
 * held the JS thread for all of them, and taps queued behind it (the cold start's freeze). A loop that may run long
 * asks its slice at each step; the slice yields to the event loop (one macrotask) once the stretch since its last
 * yield has run past the budget, and returns at once otherwise. It changes the order nothing else depends on: the
 * work is the same, it is only spread.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from './params.js';

/** How long one stretch of work may hold the thread before it gives it back (the start target: never above 100 ms). */
export const TIME_SLICE_MS = param({ key: 'runtime.timeSliceMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });

const giveBack = () => new Promise((resolve) => { setTimeout(resolve, 0); });

/**
 * One slice for one piece of long work (a read): call the returned function at every step.
 * @param {object} [o]
 * @param {number} [o.budgetMs]   a stretch longer than this yields
 * @param {() => number} [o.now]
 * @param {() => Promise<void>} [o.yieldFn]   how to give the thread back (default: one macrotask)
 * @returns {() => Promise<void>}
 */
export function createTimeSlice({ budgetMs = TIME_SLICE_MS, now = () => Date.now(), yieldFn = giveBack } = {}) {
  let since = now();
  return async function step() {
    if (now() - since < budgetMs) return;
    await yieldFn();
    since = now();
  };
}
