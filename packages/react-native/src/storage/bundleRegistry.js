/**
 * bundleRegistry — AsyncStorage-backed list of bundles (groups,
 * circles, …) the user has joined + a pointer at the active one.
 *
 * Lifted from apps/pinboard-mobile/src/lib/groupRegistry.js 2026-05-09
 * (Phase 41.0.b A5; Tasks-mobile is the second consumer — its
 * `CircleBundles.js` in Phase 41.7 reuses this shape verbatim with
 * `keyNamespace: 'tasks:circles'`).
 *
 * The plan flagged this as "deferred until both apps are running" —
 * tasks-mobile is now starting, so the lift trips the rule of two.
 *
 * Each entry is opaque (a `{groupId | circleId, displayName?, role?,
 * joinedAt?, ...}` object). The substrate doesn't validate per-app
 * fields beyond the required id field; apps cast the read result.
 */

let _defaultAsyncStorage = null;
async function _loadAsyncStorage() {
  if (_defaultAsyncStorage) return _defaultAsyncStorage;
  const mod = await import('@react-native-async-storage/async-storage');
  _defaultAsyncStorage = mod.default ?? mod;
  return _defaultAsyncStorage;
}

/**
 * @typedef {object} BundleEntry
 * @property {string} id          required — `groupId` for pinboard, `circleId` for tasks
 * @property {string} [displayName]
 * @property {number} [joinedAt]  epoch-ms
 * (apps add app-specific fields freely; the substrate passes them through)
 */

/**
 * Build a registry instance for one app's bundles.
 *
 * @param {object} args
 * @param {string} args.keyNamespace  AsyncStorage key prefix, e.g. `'pinboard:groups'` or `'tasks:circles'`
 * @param {string} [args.idField='id'] field on each entry that uniquely identifies the bundle
 * @param {object} [args.storage]      inject for tests; defaults to AsyncStorage at first use
 * @returns {{
 *   list:           () => Promise<BundleEntry[]>,
 *   add:            (entry: BundleEntry) => Promise<BundleEntry[]>,
 *   remove:         (id: string) => Promise<BundleEntry[]>,
 *   getActiveId:    () => Promise<string | null>,
 *   setActiveId:    (id: string | null) => Promise<string | null>,
 *   _internal:      { keyList: string, keyActive: string },
 * }}
 */
export function createBundleRegistry({ keyNamespace, idField = 'id', storage } = {}) {
  if (typeof keyNamespace !== 'string' || !keyNamespace) {
    throw new TypeError('createBundleRegistry: keyNamespace required');
  }
  const KEY_LIST   = `${keyNamespace}:list`;
  const KEY_ACTIVE = `${keyNamespace}:active`;

  async function _store() {
    return storage ?? await _loadAsyncStorage();
  }
  function _isEntry(e) {
    return e && typeof e === 'object' && typeof e[idField] === 'string' && e[idField].length > 0;
  }

  async function list() {
    const s = await _store();
    const raw = await s.getItem(KEY_LIST);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(_isEntry) : [];
    } catch {
      return [];
    }
  }

  async function add(entry) {
    if (!_isEntry(entry)) throw new Error('bundleRegistry.add: invalid entry');
    const s = await _store();
    const cur = await list();
    const filtered = cur.filter((g) => g[idField] !== entry[idField]);
    const next = [...filtered, { joinedAt: Date.now(), ...entry }];
    await s.setItem(KEY_LIST, JSON.stringify(next));
    return next;
  }

  async function remove(id) {
    if (typeof id !== 'string' || !id) throw new Error('bundleRegistry.remove: id required');
    const s = await _store();
    const cur = await list();
    const next = cur.filter((g) => g[idField] !== id);
    await s.setItem(KEY_LIST, JSON.stringify(next));
    const active = await getActiveId();
    if (active === id) await setActiveId(null);
    return next;
  }

  async function getActiveId() {
    const s = await _store();
    const v = await s.getItem(KEY_ACTIVE);
    return (typeof v === 'string' && v.length > 0) ? v : null;
  }

  async function setActiveId(id) {
    const s = await _store();
    if (id == null || id === '') {
      await s.removeItem(KEY_ACTIVE);
      return null;
    }
    if (typeof id !== 'string') throw new Error('bundleRegistry.setActiveId: id must be a string');
    await s.setItem(KEY_ACTIVE, id);
    return id;
  }

  return {
    list,
    add,
    remove,
    getActiveId,
    setActiveId,
    _internal: { keyList: KEY_LIST, keyActive: KEY_ACTIVE },
  };
}
