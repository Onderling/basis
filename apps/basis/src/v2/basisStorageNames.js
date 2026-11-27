import { storageName, storageNames } from './storageRegister.js';   // every storage name from the one register
/**
 * WHAT ON A SHARED WEB ORIGIN IS BASIS'S OWN — by name (ledger L1115, the start-over wipe).
 *
 * The web app shares its origin with the public site and with the toolbox screen pages (L1041), so "everything on the
 * origin" is not Basis's to remove. A start-over removes exactly the storage keys and IndexedDB databases under the one
 * prefix every register name carries (`basis.`), and leaves the rest. The browser spec `test-browser/start-over.spec.js`
 * boots the real app and fails when a key or database it leaves is not covered here: a name outside the prefix would
 * otherwise survive a start-over, sealed with a key no longer there, and stop the next boot again. The register's own
 * fitness test holds every name to the prefix, the two declared kinds outside it aside (below).
 *
 * The phone needs none of this: its AsyncStorage and SecureStore are the app's own.
 */

/** The one prefix of every name Basis stores under on the origin (storage keys and IndexedDB databases alike). */
export const BASIS_PREFIX = 'basis.';

/**
 * A name on the same origin that is NOT this device's Basis identity and stays: a toolbox screen page's own pairing
 * (the page's grant, not the person's). It sits outside the prefix already; it is said here so that stays a choice.
 */
export const KEPT_KEY_PREFIXES = Object.freeze([storageName('screenGrant')]);

/**
 * The fixed database names, for a browser that cannot list its databases (`indexedDB.databases()`): the start-over
 * deletes these by name. DERIVED from the storage register (every web store), so a store added there is deleted here
 * without a second list to keep. A database with a per-circle or per-scope suffix is found only through the listing.
 */
export const BASIS_DB_NAMES = Object.freeze(storageNames((r) => r.kind === 'store' && r.shells.includes('web')));

/** @param {string} key */
export function isBasisStorageKey(key) {
  const k = String(key ?? '');
  if (KEPT_KEY_PREFIXES.some((p) => k.startsWith(p))) return false;
  return k.startsWith(BASIS_PREFIX);
}

/** @param {string} name */
export function isBasisDatabase(name) {
  return String(name ?? '').startsWith(BASIS_PREFIX);
}
