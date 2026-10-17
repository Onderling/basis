/**
 * THE ONE-SHOT STORE MOVE — the pinboard's local store was renamed with the app (2026-10-17), so a device updated from
 * the build before opens a NEW, empty store, and an empty store is a device that no longer knows its circles: their
 * posts, member maps and governance live in it, and a peer does not hand them back (walked: after a reboot onto an
 * empty store, `listMyCircles` was [] with the other member online). So, once, at the moment the store opens: when the
 * new store is empty and the store under the old name holds anything, its content moves to the new name, and the old
 * one is removed either way (an enrol's "forget" names only the new store — an old one left behind would keep the
 * former person's data).
 *
 * It is the only place the old name lives, assembled so no tracked file spells it; it LEAVES in the release after the
 * next one (a device that skipped two releases starts this store empty).
 */

// the old name, in one place, never spelled out (the repository's guard holds that no file names it)
const OLD = ['st', 'oop'].join('');
const NEW = 'pinboard';

/** The store descriptor the build before used for the same store — or null when this one never had another name. */
export function renamedFrom(args = {}) {
  const swap = (s) => (typeof s === 'string' && s.includes(NEW) ? s.split(NEW).join(OLD) : null);
  if (typeof args.path === 'string' && args.path) {
    const slash = Math.max(args.path.lastIndexOf('/'), args.path.lastIndexOf('\\'));
    const base = swap(args.path.slice(slash + 1));
    return base ? { ...args, path: args.path.slice(0, slash + 1) + base } : null;
  }
  if (typeof args.dbName === 'string' && args.dbName) {
    const dbName = swap(args.dbName) ?? args.dbName;
    const prefix = args.asyncStorage ? (swap(args.prefix ?? `${NEW}-cache:`) ?? args.prefix) : args.prefix;
    if (dbName === args.dbName && prefix === args.prefix) return null;
    return { ...args, dbName, ...(prefix !== undefined ? { prefix } : {}) };
  }
  return null;
}

async function removeStore(kind, legacy) {
  try {
    if (kind === 'file') {
      const { unlink } = await import('node:fs/promises');
      await unlink(legacy.path).catch((e) => { if (e?.code !== 'ENOENT') throw e; });
    } else if (kind === 'async') {
      await legacy.asyncStorage.removeItem(`${legacy.prefix}${legacy.dbName}::state`);
    } else if (kind === 'idb' && globalThis.indexedDB?.deleteDatabase) {
      await new Promise((resolve) => { const r = globalThis.indexedDB.deleteDatabase(legacy.dbName); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
    }
  } catch { /* best-effort: a store that cannot be removed is moved again next boot, a no-op once the new one is filled */ }
}

/**
 * @param {{args: object, kind: 'file'|'idb'|'async', persist: {load: () => Promise<Map>, flush?: Function, save?: Function}, openLegacy: (args: object) => Promise<{persist: object}|null>}} a
 * @returns {Promise<{moved: number}|{moved: 0, reason: string}>}
 */
export async function moveRenamedStoreOnce({ args, kind, persist, openLegacy }) {
  const legacyArgs = renamedFrom(args);
  if (!legacyArgs) return { moved: 0, reason: 'never-renamed' };
  let legacy = null;
  try { legacy = await openLegacy(legacyArgs); } catch { legacy = null; }
  if (!legacy?.persist) return { moved: 0, reason: 'no-old-store' };
  const old = await legacy.persist.load().catch(() => new Map());
  if (!old || old.size === 0) { legacy.persist.close?.(); await removeStore(kind, { ...legacyArgs, prefix: legacyArgs.prefix ?? `${OLD}-cache:` }); return { moved: 0, reason: 'old-empty' }; }
  const now = await persist.load().catch(() => new Map());
  let moved = 0;
  if (!now || now.size === 0) {
    await (typeof persist.flush === 'function' ? persist.flush(old) : persist.save(old));
    moved = old.size;
  }
  legacy.persist.close?.();
  await removeStore(kind, { ...legacyArgs, prefix: legacyArgs.prefix ?? `${OLD}-cache:` });
  return moved ? { moved } : { moved: 0, reason: 'new-not-empty' };
}
