/**
 * eventLogPersistence — the DEVICE LOG survives a reload (the durability slice of the content re-root).
 *
 * Under the one-log convergence the EventLog is the source of truth — yet both shells constructed it
 * in-memory only, so every reload wiped it and the legacy chat store quietly stayed the real record (the
 * inverse of the decided hierarchy). This module closes that: load the persisted snapshot at boot →
 * `eventLog.hydrate(...)` → late-bind a DEBOUNCED save via `eventLog.setPersist(...)`. Order matters:
 * hydrate BEFORE setPersist, so hydration never echoes into storage.
 *
 * The snapshot is the whole event array as one value (the log's own `persist` contract). At today's
 * volume — a 14-day chat window + the compact system lanes (membership is exempt from pruning but bounded
 * by churn) — that is small; the flat-snapshot shape gets revisited with the chat lane (the named trigger:
 * chat volume), not gold-plated now. Saving is BEST-EFFORT: a failing storage medium degrades the app to
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
    // The log chains on the persist result — honor its promise contract (errors surface in flush).
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
