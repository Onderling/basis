/**
 * exportKeyFile — the household export key's set, unlock and lock, over the box's own files.
 *
 * ONE implementation, two doors: the box's `bin/export-key.mjs` (typed in a shell on the box) and the admin's screen
 * (the `assistant-export-key-*` ops, each after a yes in the admin's private chat). The key file keeps only the key's
 * public half and its passphrase-sealed secret (the box seals every night, it cannot open); unlocking writes the opened
 * secret beside it for an hour, for the next `/import`. A passphrase is used here and kept nowhere.
 */
import { createExportKey, unlockExportKey, MIN_PASSPHRASE } from './householdExportSeal.js';
import { EXPORT_KEY_FILE, UNLOCKED_KEY_FILE, UNLOCK_FOR_MS } from './householdExportShelf.js';

/**
 * @param {object} a
 * @param {{read: (name: string) => string|null, write: (name: string, text: string) => void, remove: (name: string) => void}} a.files
 *   the box's data directory (a written file is the box's alone: mode 0600 on disk)
 * @param {() => number} [a.now]
 * @param {object} [a.argonOpts]  tests only
 */
export function createExportKeyFile({ files, now = Date.now, argonOpts } = {}) {
  const readKey = () => { try { return JSON.parse(files.read(EXPORT_KEY_FILE) ?? 'null'); } catch { return null; } };
  return {
    /** Is a key set on this box? */
    exists: () => Boolean(readKey()),

    /**
     * A new key from the passphrase; an open old key closes. Files sealed with an old key keep needing ITS passphrase.
     * @returns {Promise<{ok: true, replaced: boolean}|{ok: false, reason: 'too-short'}>}
     */
    async set(passphrase) {
      if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) return { ok: false, reason: 'too-short' };
      const replaced = Boolean(readKey());
      files.remove(UNLOCKED_KEY_FILE);
      const key = await createExportKey({ passphrase, ...(argonOpts ? { argonOpts } : {}) });
      files.write(EXPORT_KEY_FILE, JSON.stringify(key, null, 1));
      return { ok: true, replaced };
    },

    /**
     * Open the key for the next `/import`, for an hour: the box's key, or the one a sealed file carries (`source`).
     * @returns {Promise<{ok: true, until: number}|{ok: false, reason: 'no-key'|'wrong-passphrase'}>}
     */
    async unlock(passphrase, { source = null } = {}) {
      const key = source ?? readKey();
      if (!key) return { ok: false, reason: 'no-key' };
      let secretKey;
      try { secretKey = await unlockExportKey({ key, passphrase, ...(argonOpts ? { argonOpts } : {}) }); }
      catch (e) { if (e?.message === 'wrong-passphrase') return { ok: false, reason: 'wrong-passphrase' }; throw e; }
      const until = now() + UNLOCK_FOR_MS;
      files.write(UNLOCKED_KEY_FILE, JSON.stringify({ secretKey, until }));
      return { ok: true, until };
    },

    /** Close an opened key now. */
    lock() { files.remove(UNLOCKED_KEY_FILE); },
  };
}

export { MIN_PASSPHRASE };
