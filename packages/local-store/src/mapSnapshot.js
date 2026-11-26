/**
 * mapSnapshot — the one format a persist adapter writes a store's Map in, and the gate that never saves over a
 * snapshot it could not read.
 *
 * Every persist adapter (file, IndexedDB, AsyncStorage; one copy per app that keeps a store) wrote the Map as a plain
 * JSON object and, at load, turned anything it could not parse into an EMPTY Map. The next save then wrote that empty
 * Map over the bytes it had failed to read: a person's lists, tasks or posts gone because a newer build had written a
 * shape this one did not know, or a write had been torn. Here the adapters share one reading and one writing:
 *
 * - **written** as `{"v":1,"data":{<key>:<value>,…}}`, so a later build can tell which format it is reading;
 * - **a snapshot with no `v`** is today's format before the stamp (a plain object of key → value): it reads as v1 and
 *   is stamped at the next save. Treating it as unreadable would empty every live device at the first save;
 * - **absent** (no file, no row) is an empty store, readable;
 * - **not readable** — bytes that do not parse, a shape that is not an object, a `v` this build does not know, or a
 *   read that failed — loads as an empty Map for the cache above, AND the gate refuses every save from then on, so
 *   the bytes stay as they are. Only a deliberate act replaces them (the person's start-over, which deletes the store,
 *   or an upgrade that knows the newer format). Said once in the log: the store's name and the reason, never content.
 *
 * `notReadable` (the reason, or null) is the state a surface reads to say it to the person.
 */

/** The format version this build writes and reads. */
export const MAP_SNAPSHOT_V = 1;

import { reportNotReadable, clearNotReadable } from './notReadableStores.js';

/**
 * Read stored text into a Map.
 * @param {string|null|undefined} raw  the stored text; null/undefined/'' = nothing stored
 * @param {number} [v=MAP_SNAPSHOT_V]  the stamp this store is written and read with (its storage register row's `v`)
 * @returns {{ map: Map<string, any>, notReadable: null | 'unparseable' | 'shape' | 'version' }}
 */
export function readMapSnapshot(raw, v = MAP_SNAPSHOT_V) {
  if (raw == null || raw === '') return { map: new Map(), notReadable: null };
  if (typeof raw !== 'string') return { map: new Map(), notReadable: 'shape' };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { map: new Map(), notReadable: 'unparseable' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { map: new Map(), notReadable: 'shape' };
  // Stamped = it has BOTH `v` and `data`. A plain map that merely holds a key named `v` is today's format, not a
  // stamp (store keys are paths, but a refusal for ever over one odd key is too high a price); a newer build that adds
  // a top-level field next to `v` and `data` is still read as stamped, and so refused rather than saved over.
  const own = (k) => Object.prototype.hasOwnProperty.call(parsed, k);
  if (!(own('v') && own('data'))) {
    return { map: new Map(Object.entries(parsed)), notReadable: null };   // before the stamp: today's format
  }
  if (parsed.v !== v) return { map: new Map(), notReadable: 'version' };
  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { map: new Map(), notReadable: 'shape' };
  return { map: new Map(Object.entries(data)), notReadable: null };
}

/** The text a Map is stored as, stamped with `v`. */
export function writeMapSnapshot(map, v = MAP_SNAPSHOT_V) {
  return JSON.stringify({ v, data: Object.fromEntries(map ?? []) });
}

/**
 * One adapter's gate: read through it at load, ask it for the text at every save.
 *
 * @param {string} name  the store's name for the one log line (a path or db name; never content, never shown)
 * @param {object} [opts]
 * @param {string} [opts.kind='data']  what the store holds as a person names it (`STORE_KINDS`): the notice says it
 * @param {number} [opts.v=MAP_SNAPSHOT_V]  the stamp it writes and accepts (the store's storage register row's `v`)
 * @param {(msg: string) => void} [opts.warn]
 */
export function mapSnapshotGate(name, { kind = 'data', v = MAP_SNAPSHOT_V, warn = (m) => console.warn(m) } = {}) {
  let notReadable = null;
  let said = false;
  const settle = () => {
    if (notReadable) reportNotReadable({ name, kind, reason: notReadable });
    else clearNotReadable(name);
  };
  return {
    /** The stored text (or null when nothing is stored) → the Map for the cache. */
    read(raw) {
      const r = readMapSnapshot(raw, v);
      notReadable = r.notReadable;
      settle();
      return r.map;
    },
    /** A read that failed outright (the store was there but could not be read): refuse like unreadable bytes. */
    readFailed() { notReadable = 'read-failed'; settle(); return new Map(); },
    /** The text to store, or null: a save over a snapshot this build could not read is refused. */
    encode(map) {
      if (notReadable) {
        if (!said) {
          said = true;
          try { warn(`[store] ${name}: stored data not readable by this build (${notReadable}) — kept as it is, nothing saved over it`); }
          catch { /* a log failure never breaks the store */ }
        }
        return null;
      }
      return writeMapSnapshot(map, v);
    },
    /** null, or why the stored snapshot was not readable. */
    get notReadable() { return notReadable; },
  };
}
