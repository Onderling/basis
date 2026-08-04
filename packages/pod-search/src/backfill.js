/**
 * ⏸ PARKED, NOT a deletion candidate (decided): this becomes the REBUILD-THE-INDEX gate of the Pod home.
 * An embedding index is a rebuildable projection; the moment embeddings adopt on an existing pod, a
 * from-scratch reindex is exactly what is needed — and this is it. Unreached today by design.
 * Backfill orchestrator (Phase 52.24, PLAN-podsearch-v2-embeddings §backfill).
 *
 * A one-time, **resumable**, **idle-friendly** walk that pours an existing
 * corpus through `search.indexBatch(...)` so the vector index catches up on
 * content that predates the embedder.  It leans entirely on 52.23's
 * restart-safe machinery:
 *
 *   - `indexBatch` already skips re-embedding unchanged items (content-hash
 *     cache), so a batch that was indexed on a previous run costs 0 embed
 *     calls even if it were re-fed.
 *   - the walk persists a **cursor** in the vector store; on `resume()` it
 *     restarts *after* the cursor, so completed items are neither re-read
 *     nor re-embedded — the cursor and the cache are belt-and-braces.
 *
 * ── Pod-independence (invariant #7) ───────────────────────────────────────
 * `source` is **duck-typed** `{ list, read }`.  A `@onderling/pod-client`, a
 * `@onderling/pseudo-pod`, or any in-memory adapter all satisfy it — local-only
 * is the floor, a real pod is never required.  The orchestrator never imports
 * either; the caller injects whichever source it has.
 *
 * ── Scheduling is the caller's job ────────────────────────────────────────
 * The orchestrator only *yields* between batches (a macrotask by default, or
 * an injected `yield`).  WHETHER to keep going — charging / on-wifi / device
 * idle — is app/RN policy: the caller drives it with `pause()` / `resume()`.
 * The substrate stays policy-free.
 *
 * @typedef {object} BackfillSource
 * @property {(prefix?: string) => Promise<Array<string | {uri: string}>>} list
 * @property {(uri: string) => Promise<object>} read  resolves the item to index
 */

/** Default cursor key under the owner-only derived-state tree (§3.4-adjacent). */
const DEFAULT_CURSOR_KEY = 'private/state/search-backfill/cursor';

/** @param {string | {uri: string}} entry @returns {string} */
function toUri(entry) {
  return typeof entry === 'string' ? entry : entry?.uri;
}

/** Tiny event emitter — web/RN-safe (no `node:events`). */
function createEmitter() {
  /** @type {Map<string, Set<Function>>} */
  const subs = new Map();
  return {
    on(event, cb) {
      let set = subs.get(event);
      if (!set) { set = new Set(); subs.set(event, set); }
      set.add(cb);
      return () => set.delete(cb);
    },
    off(event, cb) { subs.get(event)?.delete(cb); },
    emit(event, payload) {
      const set = subs.get(event);
      if (!set) return;
      for (const cb of set) {
        try { cb(payload); } catch { /* swallow — a faulty listener can't break the walk */ }
      }
    },
  };
}

/**
 * Create a resumable backfill orchestrator.
 *
 * @param {object} args
 * @param {import('./PodSearch.js').PodSearch} args.search  target index (52.23 persistence)
 * @param {BackfillSource} args.source                      duck-typed `{ list, read }`
 * @param {number} [args.batchSize=32]
 * @param {object} [args.cursorStore]  StorageBackend-shaped store for the cursor.
 *   Defaults to `search.vectorStore`.  Absent both ⇒ in-memory only (a kill
 *   forgets the cursor; the content-hash cache still prevents re-embeds when
 *   a store IS present on the search).
 * @param {string} [args.cursorKey='private/state/search-backfill/cursor']
 * @param {string} [args.prefix]  container prefix passed to `source.list`
 * @param {() => Promise<void> | void} [args.yield]  cooperative yield between batches
 * @returns {{
 *   run: () => Promise<void>,
 *   resume: () => Promise<void>,
 *   pause: () => void,
 *   on: (event: string, cb: Function) => (() => void),
 *   off: (event: string, cb: Function) => void,
 *   get running(): boolean,
 * }}
 */
export function createBackfill({
  search,
  source,
  batchSize = 32,
  cursorStore,
  cursorKey = DEFAULT_CURSOR_KEY,
  prefix,
  yield: yieldFn,
} = {}) {
  if (!search || typeof search.indexBatch !== 'function') {
    throw new TypeError('createBackfill: `search` with indexBatch() is required');
  }
  if (!source || typeof source.list !== 'function' || typeof source.read !== 'function') {
    throw new TypeError('createBackfill: `source` must be duck-typed { list, read }');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new TypeError('createBackfill: `batchSize` must be a positive integer');
  }

  const store = cursorStore ?? search.vectorStore ?? null;
  const emitter = createEmitter();
  const doYield = typeof yieldFn === 'function'
    ? yieldFn
    : () => new Promise((r) => { setTimeout(r, 0); });

  let paused = false;
  /** @type {Promise<void> | null} */ let active = null;

  // ── cursor persistence ─────────────────────────────────────────────
  // Shape: { prefix, lastUri, done, total }. `lastUri` is the resume anchor:
  // because we sort the uri list deterministically, "resume after lastUri"
  // is robust to items appended between runs (they simply sort later).

  async function loadCursor() {
    if (!store) return null;
    const rec = await store.get(cursorKey);
    if (!rec || rec.bytes == null) return null;
    return typeof rec.bytes === 'string' ? JSON.parse(rec.bytes) : rec.bytes;
  }
  async function saveCursor(cursor) {
    if (!store) return;
    await store.put(cursorKey, JSON.stringify(cursor));
  }
  async function clearCursor() {
    if (!store) return;
    await store.delete(cursorKey);
  }

  async function walk() {
    paused = false;
    try {
      const listed = await source.list(prefix);
      const uris = (Array.isArray(listed) ? listed : [])
        .map(toUri)
        .filter((u) => typeof u === 'string' && u.length > 0)
        .sort(); // deterministic order → stable, resumable cursor

      const total = uris.length;

      // Resume: drop everything up to and including the persisted anchor.
      // Completed items are NOT re-read and NOT re-embedded.
      const cursor = await loadCursor();
      let remaining = uris;
      let done = 0;
      if (cursor && cursor.prefix === (prefix ?? null) && cursor.lastUri != null) {
        remaining = uris.filter((u) => u > cursor.lastUri);
        done = total - remaining.length;
      }

      emitter.emit('progress', { done, total });

      for (let i = 0; i < remaining.length; i += batchSize) {
        if (paused) { emitter.emit('paused', { done, total }); return; }

        const slice = remaining.slice(i, i + batchSize);
        const items = [];
        for (const uri of slice) items.push(await source.read(uri));

        await search.indexBatch(items); // unchanged items ⇒ 0 embed calls

        done += slice.length;
        await saveCursor({ prefix: prefix ?? null, lastUri: slice[slice.length - 1], done, total });
        emitter.emit('progress', { done, total });

        // Cooperative yield — the caller may pause() here (idle/charging policy).
        await doYield();
      }

      await clearCursor(); // walk complete → the anchor is spent
      emitter.emit('done', { done, total });
    } catch (err) {
      emitter.emit('error', { code: err?.code ?? 'E_BACKFILL' });
    }
  }

  /** Start (or continue from the cursor). Idempotent while a walk is live. */
  function run() {
    if (active) return active;
    active = walk().finally(() => { active = null; });
    return active;
  }

  return {
    run,
    /** Continue after a pause / process restart — identical entry, cursor-driven. */
    resume: run,
    /** Request a cooperative pause; the walk stops at the next batch boundary. */
    pause() { paused = true; },
    on: emitter.on,
    off: emitter.off,
    get running() { return active !== null; },
  };
}
