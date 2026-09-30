/**
 * The export shelf — a household bot writes its export file every night and keeps the last few.
 *
 * The files sit in the bot's own data dir, so the box's snapshot (the backup role) carries them off the box; an admin
 * restores one with `/import <name>`. The file is the one format kept readable across versions (householdExport.js),
 * so a snapshot of an OLDER version is still usable through it. The shell hands the filesystem; this decides when,
 * what name, and what is kept.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

export const EXPORT_EVERY_MS = param({ key: 'assistant.exportEveryMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 3_600_000 });
export const EXPORT_KEEP = param({ key: 'assistant.exportKeep', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 7 });

const NAME = /^household-export-(\d{4}-\d{2}-\d{2})\.json$/;
const pad = (n) => String(n).padStart(2, '0');
/** The file's name for a moment: one a day (a second export that day replaces the first). */
export const exportNameFor = (now) => { const d = new Date(now); return `household-export-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`; };
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
 * @param {(e: {name?: string, ok: boolean, error?: string}) => void} [a.onWritten]
 */
export function createExportShelf({ files, exportNow, keep = EXPORT_KEEP, every = EXPORT_EVERY_MS, now = () => Date.now(), timers = globalThis, onWritten = null }) {
  let handle = null;
  // (`param()` hands the value itself.) Never more often than hourly, never fewer than one kept: a bad number must not
  // make the box write in a loop or delete its only copy.
  const period = Math.max(3_600_000, Number(every) || EXPORT_EVERY_MS);
  const kept = Math.max(1, Math.floor(Number(keep)) || EXPORT_KEEP);
  /** The shelf's files, newest first. */
  const names = async () => (await files.list()).filter(isExportName).sort().reverse();
  const writeNow = async () => {
    try {
      const name = exportNameFor(now());
      await files.write(name, JSON.stringify(await exportNow(), null, 1));
      for (const old of (await names()).slice(kept)) await files.remove(old);
      onWritten?.({ name, ok: true });
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
    start() { if (!handle) { handle = timers.setInterval(() => { writeNow(); }, period); handle?.unref?.(); } return writeNow(); },
    stop() { if (handle) { timers.clearInterval(handle); handle = null; } },
  };
}
