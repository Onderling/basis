/**
 * pendingSaves — the saves that are WAITING on a timer, so they can all be made at once.
 *
 * A store's persistence adapter saves on a debounce (200–400 ms after the last change): fine while the app runs, but
 * a change made in that window before a reload, a closed tab or an app sent to the background was lost — in every
 * store (found 2026-10-07, adding an appointment and closing the tab, a tester's first move). An adapter tracks its
 * pending save here while the timer runs and untracks it when the timer fires; a shell calls `flushPendingSaves()`
 * when the page or the app goes away (web: `pagehide` and a hidden tab; mobile: the app to the background).
 */

/** @type {Set<() => Promise<void>>} */
const pending = new Set();

/**
 * Track a save that is waiting. Returns the untrack (call it when the save ran on its own timer).
 * @param {() => Promise<void>|void} save
 */
export function trackPendingSave(save) {
  pending.add(save);
  return () => { pending.delete(save); };
}

/** Make every waiting save now, each once; one that fails stops none of the others. */
export async function flushPendingSaves() {
  const all = [...pending];
  pending.clear();
  await Promise.allSettled(all.map((save) => Promise.resolve().then(save)));
}

/** How many saves are waiting (for tests and diagnostics). */
export const pendingSaveCount = () => pending.size;
