import { storageName, storageNames } from './storageRegister.js';   // every storage name from the one register
/**
 * WHAT ON A SHARED WEB ORIGIN IS BASIS'S OWN — by name (ledger L1115, the start-over wipe).
 *
 * The web app shares its origin with the public site and with the toolbox screen pages (L1041), so "everything on the
 * origin" is not Basis's to remove. A start-over removes exactly the storage keys and IndexedDB databases named here
 * and leaves the rest. The browser spec `test-browser/start-over.spec.js` boots the real app and fails when a key or
 * database it leaves is not covered here: a key added under a new prefix would otherwise survive a start-over, sealed with a key no longer there,
 * and stop the next boot again. The fixed names come from the storage register (`storageRegister.js`); the prefixes
 * stay for what a key family adds at run time.
 *
 * The phone needs none of this: its AsyncStorage and SecureStore are the app's own.
 */

/** Storage-key prefixes (localStorage, sessionStorage) that are Basis's. */
export const BASIS_KEY_PREFIXES = Object.freeze(['cc-', 'cc.', 'basis.', 'circle.', 'onderling.']);

/**
 * Prefixes on the same origin that are NOT this device's Basis identity and stay: a toolbox screen page's own pairing
 * (`onderling-screen:`, the page's grant, not the person's).
 */
export const KEPT_KEY_PREFIXES = Object.freeze([storageName('screenGrant')]);

/** IndexedDB database-name prefixes that are Basis's (the stores, the key door, the pseudo-pod, the vault). */
export const BASIS_DB_PREFIXES = Object.freeze(['cc-', 'onderling-', 'basis', storageName('vaultDb')]);

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
  return BASIS_KEY_PREFIXES.some((p) => k.startsWith(p));
}

/** @param {string} name */
export function isBasisDatabase(name) {
  const n = String(name ?? '');
  return BASIS_DB_PREFIXES.some((p) => n.startsWith(p));
}
