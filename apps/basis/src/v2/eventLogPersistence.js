/**
 * eventLogPersistence — the DEVICE LOG survives a reload (the durability slice of the content re-root).
 *
 * Under the one-log convergence the EventLog is the source of truth — yet both shells constructed it
 * in-memory only, so every reload wiped it and the legacy chat store quietly stayed the real record (the
 * inverse of the decided hierarchy). This module closes that: load the persisted snapshot at boot →
 * `eventLog.hydrate(...)` → late-bind a DEBOUNCED save via `eventLog.setPersist(...)`. Order matters:
 * hydrate BEFORE setPersist, so hydration never echoes into storage.
 *
 * The log's own `persist` contract is the whole event array as one value. Until 2026-09-24 that is also how it
 * was STORED, and that shape had a ceiling: on Android one AsyncStorage row is read back through a ~2 MB cursor
 * window, and a read past it returns EMPTY rather than throwing — the next save then writes that emptiness back.
 * Chat is `record` retention (it never drops), so the log walked toward that ceiling on its own. Bytes were
 * already kept out (`attachmentBlobStore`); a face's 4 KB thumb per change brought the day closer (L120).
 * `backendSnapshotIo` now stores the array in SEGMENTS (see its note): the contract the log sees is unchanged,
 * every row stays small, and an append rewrites only the newest segment. The file shape (`fileSnapshotIo`, the
 * box) stays one file — a file has no cursor window. Saving is BEST-EFFORT: a failing storage medium degrades
 * the app to the old in-memory behaviour (logged loudly once), it never breaks an append.
 */

/** Debounce a snapshot sink: bursts of appends coalesce into one trailing write. */
function debounced(save, ms) {
  let timer = null;
  let last = null;
  let warned = false;
  const flush = () => {
    timer = null;
    const events = last;
    last = null;
    Promise.resolve(save(events)).catch((err) => {
      if (!warned) {
        warned = true;   // once — a broken medium would otherwise warn on every keystroke
        console.warn('[device-log] persist failed — the log is running in-memory this session:', err?.message ?? err);
      }
    });
  };
  return (events) => {
    last = events;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, ms);
    if (typeof timer?.unref === 'function') timer.unref();
    // The log chains on the persist result — honour its promise contract (errors surface in flush).
    return Promise.resolve();
  };
}

/**
 * Load the snapshot, hydrate the log, and wire the debounced save.
 *
 * @param {object} a
 * @param {{ hydrate: Function, setPersist: Function }} a.eventLog
 * @param {{ load: () => Promise<object[]|null>, save: (events: object[]) => Promise<void> }} a.io
 * @param {number} [a.debounceMs]
 * @returns {Promise<{ hydrated: number }>}
 */
export async function wireEventLogPersistence({ eventLog, io, debounceMs = 400 } = {}) {
  if (!eventLog || typeof eventLog.hydrate !== 'function' || typeof eventLog.setPersist !== 'function') {
    throw new Error('wireEventLogPersistence: an eventLog with hydrate + setPersist is required');
  }
  if (!io || typeof io.load !== 'function' || typeof io.save !== 'function') {
    throw new Error('wireEventLogPersistence: an io with load + save is required');
  }
  let hydrated = 0;
  try {
    const events = await io.load();
    if (Array.isArray(events) && events.length) hydrated = eventLog.hydrate(events);
  } catch (err) {
    // A corrupt/unreadable snapshot degrades to an empty log — never a broken boot.
    console.warn('[device-log] snapshot load failed — starting empty:', err?.message ?? err);
  }
  eventLog.setPersist(debounced(io.save, debounceMs));
  return { hydrated };
}

const REF = 'device-log/events.json';

/**
 * The most JSON one SEGMENT may hold. Android's AsyncStorage reads a row through a ~2 MB cursor window and
 * returns EMPTY past it (see the module note); sealing and base64 grow a value by ~⅓ before it lands. 256 KB of
 * plain JSON per row keeps every segment far under the window with that growth included, and small enough that
 * rewriting the newest one on every append is cheap.
 */
export const SEGMENT_MAX_CHARS = 256 * 1024;
const SEGMENT_MAX_EVENTS = 2000;

/** A cheap content hash, so an unchanged segment is recognised without a byte compare against storage. */
function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + text.length;
}

/** Cut an OLDEST-first list into segments by size and count. Old segments stay byte-stable across saves. */
function segment(oldestFirst) {
  const segments = [];
  let cur = []; let curChars = 1;   // "[" … "]"
  for (const e of oldestFirst) {
    const t = JSON.stringify(e);
    if (cur.length && (curChars + t.length + 1 > SEGMENT_MAX_CHARS || cur.length >= SEGMENT_MAX_EVENTS)) {
      segments.push(cur); cur = []; curChars = 1;
    }
    cur.push(t); curChars += t.length + 1;
  }
  if (cur.length || segments.length === 0) segments.push(cur);
  return segments.map((parts) => '[' + parts.join(',') + ']');
}

/**
 * Snapshot io over a StorageBackend (`put(key, bytes)` / `get(key) → {bytes}|null` / `list(prefix)` /
 * `delete(key)`) — the web AND mobile shape (`pickWebBackend`: IndexedDB when available; the AsyncStorage
 * adapter on the phone; in-memory under SSR/tests).
 *
 * THE LOG IS STORED IN SEGMENTS (L120). The log's own contract is unchanged — `save(events)` gets the whole
 * newest-first array, `load()` returns it — but underneath the array is cut, OLDEST first, into segments of at most
 * `SEGMENT_MAX_CHARS`, each its own row under `<ref>/seg/NNNN`, with a MANIFEST at `<ref>` naming them in order
 * with a hash each. Why: one value for the whole log walked toward Android's cursor window, past which the read
 * returns empty and the next save writes that emptiness back — silent loss of the record. Cutting from the oldest
 * end means an append changes only the newest segment; a save compares hashes and rewrites only what moved.
 *
 * The write order is the safety: segments first, the manifest last, so a save that dies mid-way leaves the
 * previous manifest pointing at the previous segments (a new segment nobody names is harmless). A segment that
 * will not parse loses ITSELF — the loader warns and keeps the rest, in order — never the whole log.
 *
 * MIGRATION: a `<ref>` that holds an ARRAY is the old single-value snapshot; it loads as before and the next save
 * writes it as segments and replaces the array with the manifest. No flag, no second key.
 */
export function backendSnapshotIo(backend, ref = REF) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const segKey = (i) => `${ref}/seg/${String(i).padStart(4, '0')}`;
  const readText = async (key) => {
    const rec = await backend.get(key);
    if (!rec || rec.bytes == null) return null;
    return typeof rec.bytes === 'string' ? rec.bytes : dec.decode(rec.bytes);
  };
  let known = null;   // the manifest as last written/read by THIS io: [{key, hash}] — the diff's left-hand side
  return {
    async load() {
      const head = await readText(ref);
      if (head == null) return null;
      const parsed = JSON.parse(head);
      if (Array.isArray(parsed)) { known = null; return parsed; }               // the legacy single value
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.segments)) throw new Error('device-log: manifest not understood');
      const out = [];   // oldest first while reading
      for (const seg of parsed.segments) {
        const t = await readText(seg.key);
        if (t == null) { console.warn(`[device-log] segment missing, skipped: ${seg.key}`); continue; }
        try { out.push(...JSON.parse(t)); }
        catch (err) { console.warn(`[device-log] segment unreadable, skipped: ${seg.key} — ${err?.message ?? err}`); }
      }
      known = parsed.segments.map((s) => ({ key: s.key, hash: s.hash }));
      out.reverse();   // the log's snapshot is newest-first
      return out;
    },
    async save(events) {
      const texts = segment([...events].reverse());
      const next = texts.map((t, i) => ({ key: segKey(i), hash: hashOf(t), count: JSON.parse(t).length }));
      // segments first: only the ones whose content moved
      for (let i = 0; i < texts.length; i += 1) {
        const prev = known?.[i];
        if (prev && prev.key === next[i].key && prev.hash === next[i].hash) continue;
        await backend.put(next[i].key, enc.encode(texts[i]));
      }
      // the manifest last — the switch
      await backend.put(ref, enc.encode(JSON.stringify({ v: 1, segments: next, total: events.length })));
      // then the rows no manifest names any more (a shrunk log after retention pruned it)
      const stale = (known ?? []).slice(texts.length);
      for (const s of stale) { try { await backend.delete?.(s.key); } catch { /* best-effort */ } }
      if (!known && typeof backend.list === 'function') {   // first segmented save on a store: sweep any leftovers
        try {
          const named = new Set(next.map((n) => n.key));
          for (const k of await backend.list(`${ref}/seg/`)) if (!named.has(k)) await backend.delete?.(k);
        } catch { /* best-effort */ }
      }
      known = next.map((n) => ({ key: n.key, hash: n.hash }));
    },
  };
}

/** Snapshot io over a plain FILE — the node shape, for a device that runs on a machine rather than in
 *  an app. Written whole and replaced, like the other two: the log is one snapshot, not an append file,
 *  so a half-written save is a corrupt snapshot the loader must survive. It does: a load that throws
 *  degrades to an empty log rather than a broken boot. The write goes to a temporary neighbour first and
 *  is renamed over the target, which on every filesystem this runs on is atomic — so a process killed
 *  mid-save leaves the previous snapshot intact instead of a truncated one. */
/** A `{getItem, setItem, removeItem}` store over one JSON file — the node shape of the shells' plain
 *  storage (localStorage, AsyncStorage), for what a device on a machine stashes between two starts:
 *  the add-a-device offer that waits out the enrol ceremony. Same write discipline as the snapshot io. */
export function fileKeyValueStorage(filePath) {
  const read = async () => {
    const { readFile } = await import('node:fs/promises');
    try { const v = JSON.parse(await readFile(filePath, 'utf8')); return (v && typeof v === 'object') ? v : {}; }
    catch (err) { if (err?.code === 'ENOENT') return {}; throw err; }
  };
  const write = async (map) => {
    const { writeFile, rename, mkdir } = await import('node:fs/promises');
    const dir = filePath.slice(0, filePath.lastIndexOf('/'));
    if (dir) await mkdir(dir, { recursive: true }).catch(() => { /* it usually exists */ });
    const tmp = `${filePath}.tmp`;
    await writeFile(tmp, JSON.stringify(map), { mode: 0o600 });
    await rename(tmp, filePath);
  };
  return {
    async getItem(key) { return (await read())[key] ?? null; },
    async setItem(key, value) { const m = await read(); m[key] = String(value); await write(m); },
    async removeItem(key) { const m = await read(); delete m[key]; await write(m); },
  };
}

export function fileSnapshotIo(filePath) {
  return {
    async load() {
      const { readFile } = await import('node:fs/promises');
      try { return JSON.parse(await readFile(filePath, 'utf8')); }
      catch (err) { if (err?.code === 'ENOENT') return null; throw err; }
    },
    async save(events) {
      const { writeFile, rename, mkdir } = await import('node:fs/promises');
      const dir = filePath.slice(0, filePath.lastIndexOf('/'));
      if (dir) await mkdir(dir, { recursive: true }).catch(() => { /* it usually exists */ });
      const tmp = `${filePath}.tmp`;
      await writeFile(tmp, JSON.stringify(events), { mode: 0o600 });
      await rename(tmp, filePath);
    },
  };
}

