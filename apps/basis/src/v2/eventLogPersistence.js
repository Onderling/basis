/**
 * eventLogPersistence — the DEVICE LOG survives a reload (the durability slice of the content re-root).
 *
 * Under the one-log convergence the EventLog is the source of truth — yet both shells constructed it
 * in-memory only, so every reload wiped it and the legacy chat store quietly stayed the real record (the
 * inverse of the decided hierarchy). This module closes that: load the persisted snapshot at boot →
 * `eventLog.hydrate(...)` → late-bind a DEBOUNCED save via `eventLog.setPersist(...)`. Order matters:
 * hydrate BEFORE setPersist, so hydration never echoes into storage.
 *
 * The snapshot is the whole event array as one value (the log's own `persist` contract), and that shape
 * has a CEILING worth knowing: on Android this value is one AsyncStorage row, read back through a ~2 MB
 * cursor window, and a read past it returns EMPTY rather than throwing — the next save then writes that
 * emptiness back. Chat is `record` retention (it never drops and never compacts, because the entry IS the
 * record), so the log grows for the life of a circle and walks toward that ceiling on its own. Bytes are
 * already kept out (see `attachmentBlobStore`); the flat-snapshot shape itself is the remaining half, and
 * the trigger this comment used to defer to — chat volume — has effectively arrived.
 * (Before 2026-09-03 this said "a 14-day chat window", which was never true of `record` retention.) Saving is BEST-EFFORT: a failing storage medium degrades the app to
 * the old in-memory behaviour (logged loudly once), it never breaks an append.
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

/** Snapshot io over a StorageBackend (`put(key, bytes)` / `get(key) → {bytes}|null`) — the web shape
 *  (`pickWebBackend`: IndexedDB when available, in-memory under SSR/tests). */
export function backendSnapshotIo(backend, ref = REF) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  return {
    async load() {
      const rec = await backend.get(ref);
      if (!rec || rec.bytes == null) return null;
      const text = typeof rec.bytes === 'string' ? rec.bytes : dec.decode(rec.bytes);
      return JSON.parse(text);
    },
    async save(events) {
      await backend.put(ref, enc.encode(JSON.stringify(events)));
    },
  };
}

/** Snapshot io over an AsyncStorage-shaped store (`getItem`/`setItem`) — the mobile shape. */
export function asyncStorageSnapshotIo(storage, key = 'cc-device-log') {
  return {
    async load() {
      const text = await storage.getItem(key);
      return text ? JSON.parse(text) : null;
    },
    async save(events) {
      await storage.setItem(key, JSON.stringify(events));
    },
  };
}
