/**
 * WHAT THE LAUNCHER SAYS WHEN THE START FAILED — one decision, both shells (ledger L1115).
 *
 * A failed agent boot was already said on the launcher (`circle.boot_failed`, with the raw reason). One failure gets
 * its own words and a way on: the device's content key is stored but could not be read (`ContentKeyUnreadable`,
 * contentAtRest.js). Nothing was changed, so trying again is the first thing to offer; restoring from the phrase is
 * the second, said in words, because it starts this device over. The shells only paint what this returns.
 *
 * And a save the person made that was REFUSED because the value it would replace could not be opened
 * (`StoredValueUnreadable`, localStoreSeal.js): said once per stored value, in the same place.
 */
import { isContentKeyUnreadable } from './contentAtRest.js';

/**
 * @param {unknown} err  the boot's error (an Error, or the string a shell kept), or null
 * @returns {null | {key: string, params: object, retry: boolean, startOver?: boolean}}  the locale key to paint, its
 *   params, whether the shell offers "try again" (a fresh start of the app), and, second, "start this device over from
 *   your phrase" (startOver.js)
 */
export function bootFailureNotice(err) {
  if (err == null || err === false) return null;
  // "Try again" first; the way out second: start this device over from the phrase (startOver.js, L1115)
  if (isContentKeyUnreadable(err)) return { key: 'circle.boot_content_unreadable', params: {}, retry: true, startOver: true };
  const reason = typeof err === 'string' ? err : String(err?.message ?? err);
  return { key: 'circle.boot_failed', params: { reason }, retry: false };
}

/** The words for a refused save (`onStoredValueRefused`): one notice, whatever the store. */
export function storedValueRefusedNotice() {
  return { key: 'circle.stored_value_unreadable', params: {} };
}
