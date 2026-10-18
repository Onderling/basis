/**
 * firstLaunchFlag — pure helpers for an AsyncStorage-backed boolean
 * flag used by first-launch warning gates (privacy notice, T&Cs, etc.).
 *
 * Lifted from apps/pinboard-mobile/src/lib/metadataWarning.js 2026-05-09
 * (Phase 41.0.b A4; Tasks-mobile is the second consumer). The
 * substrate parameterizes the storage key + storage backend so each
 * gate (privacy, T&Cs, what's-new) gets its own flag without each
 * one re-implementing the same three functions.
 *
 * `AsyncStorage` is loaded lazily so test envs that don't install
 * `@react-native-async-storage/async-storage` keep working when they
 * inject `storage` directly.
 */

let _defaultAsyncStorage = null;
async function _loadAsyncStorage() {
  if (_defaultAsyncStorage) return _defaultAsyncStorage;
  const mod = await import('@react-native-async-storage/async-storage');
  _defaultAsyncStorage = mod.default ?? mod;
  return _defaultAsyncStorage;
}

/**
 * Build a get/mark/reset triple for one flag key.
 *
 * @param {object} args
 * @param {string} args.key            AsyncStorage key (per-app namespace prefix is the caller's job)
 * @param {object} [args.storage]      inject for tests; defaults to AsyncStorage at first use
 * @returns {{
 *   has:   () => Promise<boolean>,
 *   mark:  () => Promise<void>,
 *   reset: () => Promise<void>,
 * }}
 */
export function firstLaunchFlag({ key, storage } = {}) {
  if (typeof key !== 'string' || !key) {
    throw new TypeError('firstLaunchFlag: key required');
  }
  async function _store() {
    return storage ?? await _loadAsyncStorage();
  }
  return {
    async has() {
      const s = await _store();
      const v = await s.getItem(key);
      return v === '1' || v === 'true' || v === 'yes';
    },
    async mark() {
      const s = await _store();
      await s.setItem(key, '1');
    },
    async reset() {
      const s = await _store();
      await s.removeItem(key);
    },
  };
}
