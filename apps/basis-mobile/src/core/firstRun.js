import { storageName } from '../../../basis/src/v2/storageRegister.js';   // every storage name from the one register
/**
 * basis-mobile — first-run identity probe (5.9b).
 *
 * The chat-side vault persists `agent-privkey` under
 * `basis.chat-id:agent-privkey`; its absence is the canonical signal that
 * this device has no basis identity yet.  We also write a
 * `basis.welcomed` flag once the user dismisses the welcome screen, so the
 * intro can't accidentally re-appear if the vault is cleared but the
 * marker survives (or the substrate path changes underneath us).
 *
 * Pure: every read/write goes through the caller-supplied AsyncStorage
 * instance, so vitest can drive the whole flow with a Map-backed mock
 * without any RN runtime.
 */

const CHAT_IDENTITY_KEY = `${storageName('vaultChatId')}agent-privkey`;   // the chat identity's own key in its vault
const WELCOMED_KEY      = storageName('welcomed');

/**
 * Decide whether to show the first-run welcome.  True when neither the
 * vault has a chat identity nor the user has previously dismissed the
 * welcome on this device.
 *
 * Errors from AsyncStorage are treated as "no identity" — better to
 * show the welcome an extra time than to silently skip it on a real
 * first run because storage hiccuped.
 *
 * @param {{getItem: (k: string) => Promise<string|null>}} asyncStorage
 * @returns {Promise<boolean>}
 */
export async function shouldShowFirstRunWelcome(asyncStorage) {
  if (!asyncStorage || typeof asyncStorage.getItem !== 'function') return true;
  let welcomed = null;
  try { welcomed = await asyncStorage.getItem(WELCOMED_KEY); } catch { /* noop */ }
  if (welcomed === '1') return false;
  let identity = null;
  try { identity = await asyncStorage.getItem(CHAT_IDENTITY_KEY); } catch { /* noop */ }
  return !identity;
}

/**
 * Persist the "welcome dismissed" marker so the screen won't re-appear
 * on the next boot, even before the vault has finished writing.  Pure
 * fire-and-forget — caller doesn't need to await.
 *
 * @param {{setItem: (k: string, v: string) => Promise<void>}} asyncStorage
 * @returns {Promise<void>}
 */
export async function markWelcomeDismissed(asyncStorage) {
  if (!asyncStorage || typeof asyncStorage.setItem !== 'function') return;
  try { await asyncStorage.setItem(WELCOMED_KEY, '1'); } catch { /* noop */ }
}

/** Test seam: wipe the welcomed marker (used by tests + a future reset slash). */
export async function clearWelcomeMarker(asyncStorage) {
  if (!asyncStorage || typeof asyncStorage.removeItem !== 'function') return;
  try { await asyncStorage.removeItem(WELCOMED_KEY); } catch { /* noop */ }
}

export const FIRST_RUN_STORAGE_KEYS = Object.freeze({
  chatIdentity: CHAT_IDENTITY_KEY,
  welcomed:     WELCOMED_KEY,
});
