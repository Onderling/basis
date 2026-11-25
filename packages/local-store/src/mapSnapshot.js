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

/**
 * Read stored text into a Map.
 * @param {string|null|undefined} raw  the stored text; null/undefined/'' = nothing stored
 * @returns {{ map: Map<string, any>, notReadable: null | 'unparseable' | 'shape' | 'version' }}
 */
export function readMapSnapshot(raw) {
  if (raw == null || raw === '') return { map: new Map(), notReadable: null };
  if (typeof raw !== 'string') return { map: new Map(), notReadable: 'shape' };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { map: new Map(), notReadable: 'unparseable' }; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { map: new Map(), notReadable: 'shape' };
  if (!Object.prototype.hasOwnProperty.call(parsed, 'v')) {
    return { map: new Map(Object.entries(parsed)), notReadable: null };   // before the stamp: today's format
  }
  if (parsed.v !== MAP_SNAPSHOT_V) return { map: new Map(), notReadable: 'version' };
  const data = parsed.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { map: new Map(), notReadable: 'shape' };
  return { map: new Map(Object.entries(data)), notReadable: null };
}

/** The text a Map is stored as. */
export function writeMapSnapshot(map) {
  return JSON.stringify({ v: MAP_SNAPSHOT_V, data: Object.fromEntries(map ?? []) });
}

/**
 * One adapter's gate: read through it at load, ask it for the text at every save.
 *
 * @param {string} name  the store's name for the one log line (a path or db name; never content)
 * @param {(msg: string) => void} [warn]
 */
export function mapSnapshotGate(name, warn = (m) => console.warn(m)) {
  let notReadable = null;
  let said = false;
  return {
    /** The stored text (or null when nothing is stored) → the Map for the cache. */
    read(raw) {
      const r = readMapSnapshot(raw);
      notReadable = r.notReadable;
      return r.map;
    },
    /** A read that failed outright (the store was there but could not be read): refuse like unreadable bytes. */
    readFailed() { notReadable = 'read-failed'; return new Map(); },
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
      return writeMapSnapshot(map);
    },
    /** null, or why the stored snapshot was not readable. */
    get notReadable() { return notReadable; },
  };
}
