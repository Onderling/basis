/**
 * seenInbound — the device's durable record of the messages it has TAKEN, so a repeat lands once, also after a restart.
 *
 * The receive path asks `has(key)` before handing a frame to the app and calls `add(key)` once the app accepted it
 * (see `handToApp` in createSecureAgent.js). The key is `(sender address, message id)`; this record never stores it:
 * a row is the first 64 bits of its SHA-256, so the record does not say in the clear who wrote to this device, and
 * 64 bits is ample for a ring of tens of thousands.
 *
 * BOUNDED twice. By AGE: the window is the `short` retention class of the one kind/retention table (the same table
 * the device log prunes by), so the two cannot drift. By COUNT: at most `secureAgent.seenInboundCap` rows; past it
 * the oldest go first. A repeat older than the window lands again — the window is the promise, not forever.
 *
 * Stored in its OWN store row, apart from the device log and the outbox: every row is ~30 bytes, so the cap keeps
 * the value well under the ~2 MB a single Android storage row can be read back through. Loaded once at boot into a
 * Map; saved debounced, pruned on every save. A store that fails to read starts empty (a repeat may land again);
 * one that fails to write keeps the record in memory for this run.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { RETAIN, retentionWindowFor } from '@onderling/item-store';

export const SEEN_INBOUND_CAP = param({ key: 'secureAgent.seenInboundCap', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20_000 });
const SEEN_INBOUND_SAVE_DELAY_MS = param({ key: 'secureAgent.seenInboundSaveDelayMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1_000 });

/** The age window, read from the shared table — exported so the agreement test can hold the two together. */
export function seenInboundWindowMs() {
  return retentionWindowFor(RETAIN.SHORT);
}

const enc = new TextEncoder();
function rowOf(key) {
  const h = sha256(enc.encode(String(key)));
  let out = '';
  for (let i = 0; i < 8; i += 1) out += h[i].toString(16).padStart(2, '0');
  return out;
}

/**
 * @param {object} args
 * @param {{read: (uri: string) => Promise<any>, write: (uri: string, value: string) => Promise<any>}} args.store
 * @param {string} [args.uri]
 * @param {number} [args.cap]
 * @param {number} [args.saveDelayMs]
 * @param {() => number} [args.now]
 * @returns {{ has(key: string): Promise<boolean>, add(key: string): Promise<void>, flush(): Promise<void>,
 *            ready: Promise<number>, size(): number, windowMs: number, cap: number }}
 */
export function createSeenInboundRing({
  store, uri = 'mem://secure-agent/seen-inbound.json', cap = SEEN_INBOUND_CAP, saveDelayMs = SEEN_INBOUND_SAVE_DELAY_MS, now = Date.now,
} = {}) {
  const windowMs = seenInboundWindowMs();
  const rows = new Map();          // row → seen-at (seconds); insertion order is oldest first
  let timer = null;
  let writing = Promise.resolve();

  const ready = (async () => {
    if (!store || typeof store.read !== 'function') return 0;
    try {
      const raw = await store.read(uri);
      const text = typeof raw === 'string' ? raw : raw?.content ?? null;
      const parsed = text ? JSON.parse(text) : null;
      if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.rows)) return 0;
      const oldest = Math.floor((now() - windowMs) / 1000);
      for (const r of parsed.rows) {
        if (!Array.isArray(r) || typeof r[0] !== 'string' || typeof r[1] !== 'number' || r[1] < oldest) continue;
        rows.set(r[0], r[1]);
      }
      return rows.size;
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[secure-agent] the inbound record is unreadable — starting empty', err?.message ?? err);
      return 0;
    }
  })();

  function prune() {
    const oldest = Math.floor((now() - windowMs) / 1000);
    for (const [row, at] of rows) { if (at >= oldest) break; rows.delete(row); }   // oldest first: stop at the first young row
    while (rows.size > cap) rows.delete(rows.keys().next().value);
  }

  function save() {
    timer = null;
    prune();
    const value = JSON.stringify({ v: 1, rows: [...rows] });
    writing = writing.then(async () => {
      try { await store.write(uri, value); }
      catch (err) { if (typeof console !== 'undefined') console.warn('[secure-agent] the inbound record was not saved', err?.message ?? err); }
    });
    return writing;
  }

  function schedule() {
    if (!store || typeof store.write !== 'function' || timer) return;
    timer = setTimeout(save, saveDelayMs);
    timer?.unref?.();   // a pending save never keeps a process alive; shutdown flushes it
  }

  return {
    ready,
    windowMs,
    cap,
    size: () => rows.size,
    async has(key) {
      await ready;
      const at = rows.get(rowOf(key));
      return typeof at === 'number' && at >= Math.floor((now() - windowMs) / 1000);
    },
    async add(key) {
      await ready;
      const row = rowOf(key);
      rows.delete(row);                                   // re-inserted as the newest
      rows.set(row, Math.floor(now() / 1000));
      if (rows.size > cap) rows.delete(rows.keys().next().value);
      schedule();
    },
    async flush() {
      if (timer) { clearTimeout(timer); return save(); }
      return writing;
    },
  };
}
