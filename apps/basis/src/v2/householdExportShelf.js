/**
 * The export shelf — a household bot writes its export file every night and keeps the last few.
 *
 * The files sit in the bot's own data dir, so the box's snapshot (the backup role) carries them off the box; an admin
 * restores one with `/import <name>`. The file is the one format kept readable across versions (householdExport.js),
 * so a snapshot of an OLDER version is still usable through it. The shell hands the filesystem; this decides when,
 * what name, and what is kept.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { sealExport } from './householdExportSeal.js';

export const EXPORT_EVERY_MS = param({ key: 'assistant.exportEveryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 3_600_000 });
export const EXPORT_KEEP = param({ key: 'assistant.exportKeep', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 });
/** How long a key unlocked on the box stays open for an /import (the import closes it sooner). */
export const UNLOCK_FOR_MS = param({ key: 'assistant.exportUnlockMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3_600_000 });
/** In the bot's data dir: the admin's export key (its public half + its passphrase-sealed secret), and the key while
 *  it is unlocked. One name each, read by the box and by `bin/export-key.mjs`. */
export const EXPORT_KEY_FILE = 'export-key.json';
export const UNLOCKED_KEY_FILE = 'export-key.unlocked';

/** The unlocked key's secret, while it is still open; null otherwise. */
export function unlockedSecret(text, now = Date.now()) {
  try { const o = JSON.parse(text); return o?.secretKey && Number(o.until) > now ? o.secretKey : null; } catch { return null; }
}

const NAME = /^household-export-(\d{4}-\d{2}-\d{2})-(\d{4})\.json$/;
const pad = (n) => String(n).padStart(2, '0');
/** The file's name for a moment, to the minute: a write never replaces an earlier file. */
export const exportNameFor = (now) => { const d = new Date(now); return `household-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`; };
/** Is this one of the shelf's files (and not anything else a person might name)? */
export const isExportName = (name) => NAME.test(String(name ?? ''));

/**
 * @param {object} a
 * @param {{list: () => Promise<string[]>, write: (name: string, text: string) => Promise<void>, read: (name: string) => Promise<string>, remove: (name: string) => Promise<void>}} a.files
 * @param {() => Promise<object>} a.exportNow  the household's export file, now
 * @param {number} [a.keep]
 * @param {number} [a.every]
 * @param {() => number} [a.now]
 * @param {{setInterval: Function, clearInterval: Function}} [a.timers]
 * @param {(e: {name?: string, ok: boolean, error?: string, sealed?: boolean}) => void} [a.onWritten]
 * @param {() => Promise<{publicKey: string, sealedSecret: string}|null>} [a.sealWith]  the admin's export key, or null (plain)
 */
/** Does an export hold anything (an entry, a chore, an appointment, a person)? */
const holds = (f) => (f && typeof f.holds === 'boolean' ? f.holds   // a sealed file says only this, beside its ciphertext
  : Boolean(f && ((f.people ?? []).length || (f.loose ?? []).length || (f.lists ?? []).some((l) => (l.entries ?? []).length))));

export function createExportShelf({ files, exportNow, keep = EXPORT_KEEP, every = EXPORT_EVERY_MS, now = () => Date.now(), timers = globalThis, onWritten = null, sealWith = null }) {
  let handle = null;
  // (`param()` hands the value itself.) Never more often than hourly, never fewer than one kept: a bad number must not
  // make the box write in a loop or delete its only copy.
  const period = Math.max(3_600_000, Number(every) || EXPORT_EVERY_MS);
  const kept = Math.max(1, Math.floor(Number(keep)) || EXPORT_KEEP);
  /** The shelf's files, newest first. */
  const names = async () => (await files.list()).filter(isExportName).sort().reverse();
  const readQuiet = async (n) => { try { return JSON.parse(await files.read(n)); } catch { return null; } };
  const writeNow = async () => {
    try {
      const name = exportNameFor(now());
      const plain = await exportNow();
      // sealed to the admin's export key when one is set (read at every write: it may be set after the box started)
      const key = typeof sealWith === 'function' ? await sealWith() : null;
      const file = key ? { ...sealExport(plain, key), holds: holds(plain) } : plain;
      await files.write(name, JSON.stringify(file, null, 1));
      // The newest `kept` stay, and so does the newest file that HOLDS something: a version that cannot read its store
      // boots empty, and a week of empty exports must not rotate the last good one away.
      const all = await names();
      let good = null;
      for (const n of all) { if (holds(await readQuiet(n))) { good = n; break; } }
      for (const old of all.slice(kept)) if (old !== good) await files.remove(old);
      onWritten?.({ name, ok: true, sealed: Boolean(key) });
      return name;
    } catch (e) {
      onWritten?.({ ok: false, error: e?.message ?? String(e) });
      return null;
    }
  };
  return {
    names,
    writeNow,
    /** One of the shelf's files, parsed; a name that is not the shelf's is refused (never a path). */
    async read(name) {
      if (!isExportName(name)) throw new Error('not-an-export-name');
      return JSON.parse(await files.read(name));
    },
    // no write at boot: a box that restarts in a loop, or boots a version that cannot read its store, must not fill the
    // shelf; the first export comes one period after the start
    start() { if (!handle) { handle = timers.setInterval(() => { writeNow(); }, period); handle?.unref?.(); } return Promise.resolve(null); },
    stop() { if (handle) { timers.clearInterval(handle); handle = null; } },
  };
}
