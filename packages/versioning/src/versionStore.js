/**
 * versionStore.js — backend-agnostic snapshot versioning (option A).
 *
 * Preserves the *policy* proven in Folio's `sync-engine/versions.js`
 * (versionable predicate · debounce · empty-first-skip · per-series retention
 * cap · newest-first ordering · restore-is-undoable) but stores each snapshot
 * as one record in an injected `StorageBackend` (get/put/delete/list) instead
 * of a filesystem tree. So ONE store serves Folio-files, circle-objects, AND
 * pod-resources — the anti-drift consolidation in
 * plans/PLAN-pod-versioning-history-recovery.md.
 *
 * Why not lift versions.js as-is: its adapter is a *filesystem* (dirs, stat,
 * sidecars, tmp-then-rename) — the wrong shape for a pod, which is a flat KV
 * with prefix-list. We keep the good, tested policy and swap the storage half.
 * A pod points a KV backend at this store; Folio points `NodeFsBackend`. Folio's
 * *browsable* `.md` version snapshots are not produced by `NodeFsBackend` (opaque
 * hashed records) — a browsable-FS backend + a cross-series byte-budget are
 * OPTIONAL later additions (snapshot-browsing is a nice-to-have; editing working
 * files is preserved by Folio's own local sync). See
 * plans/PLAN-pod-versioning-history-recovery.md.
 *
 * Storage layout: one record per version at key
 *   `<versionsRoot><encodeURIComponent(uri)>/<ts>`            (single-writer)
 *   `<versionsRoot><encodeURIComponent(uri)>/<ts>-<writerId>`  (multi-writer)
 * value (the backend's opaque `bytes`) = `{ ts, sha256, size, content, writer? }`.
 * A series is enumerated via `backend.list(seriesPrefix)`; entries sort by
 * `ts` (then writer) newest-first. `ts` is kept strictly increasing per series
 * for one writer (same-millisecond bump), and the `writerId` suffix (pass the
 * deviceId) makes CONCURRENT writers on a shared/replicated backend collision-
 * free — two devices capturing in the same millisecond produce distinct keys
 * instead of clobbering. `read`/`restore` accept either the numeric `ts`
 * (newest match wins) or the full version `id` (`"<ts>-<writer>"`, exact).
 *
 * The store is storage-pure: it never reads or writes the *live* resource
 * itself. Restore's undoable pre-snapshot uses the injected `readLive`, and the
 * write-back uses `writeLive` — so Folio writes the working file, the pod
 * writes the pod resource, and this module stays backend-agnostic.
 */

export const DEFAULT_VERSIONS_PER_SERIES = 50;
export const DEFAULT_DEBOUNCE_MS = 5_000;
export const DEFAULT_VERSIONS_ROOT = 'versions/';

const encodeUri = (uri) => encodeURIComponent(String(uri));
const textBytes = (s) => new TextEncoder().encode(s).length;

/** Byte length of string | Uint8Array | typed-array content (RN-safe: no Buffer). */
function byteLength(content) {
  if (content == null) return 0;
  if (typeof content === 'string') return textBytes(content);
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) return content.byteLength;
  return textBytes(String(content));
}

function isEmptyContent(content) {
  if (content == null) return true;
  if (typeof content === 'string') return content.length === 0;
  if (content instanceof Uint8Array || ArrayBuffer.isView(content)) return content.byteLength === 0;
  return false;
}

/**
 * @param {object} cfg
 * @param {{get,put,delete,list}} cfg.backend  StorageBackend (a superset is fine).
 * @param {(content:string|Uint8Array)=>Promise<string>} cfg.hash  async sha256→hex (injected; no crypto import here).
 * @param {()=>number} [cfg.now]  clock seam (default Date.now).
 * @param {(uri:string)=>Promise<string|Uint8Array>} [cfg.readLive]  read current live content (for undoable restore).
 * @param {(uri:string, content:*)=>Promise<void>} [cfg.writeLive]  write restored content back to the live resource.
 * @param {{perSeries?:number, debounceMs?:number, shouldVersion?:(uri:string)=>boolean}} [cfg.retention]
 * @param {string} [cfg.versionsRoot]  key prefix for the version store (default 'versions/').
 * @param {string} [cfg.writerId]  disambiguates concurrent writers on a shared
 *   backend (pass the deviceId). Omit for single-writer consumers (plain-ts keys).
 */
export function createVersionStore({
  backend,
  hash,
  now,
  readLive,
  writeLive,
  retention = {},
  versionsRoot = DEFAULT_VERSIONS_ROOT,
  writerId,
} = {}) {
  if (!backend
    || typeof backend.get !== 'function' || typeof backend.put !== 'function'
    || typeof backend.delete !== 'function' || typeof backend.list !== 'function') {
    throw new TypeError('createVersionStore: backend must implement { get, put, delete, list }');
  }
  if (typeof hash !== 'function') {
    throw new TypeError('createVersionStore: hash must be a function (content) => Promise<hex>');
  }

  const perSeries = Number.isFinite(retention.perSeries) && retention.perSeries > 0
    ? Math.floor(retention.perSeries)
    : DEFAULT_VERSIONS_PER_SERIES;
  const debounceMs = Number.isFinite(retention.debounceMs) ? retention.debounceMs : DEFAULT_DEBOUNCE_MS;
  const shouldVersion = typeof retention.shouldVersion === 'function' ? retention.shouldVersion : () => true;
  const root = String(versionsRoot);
  const clock = typeof now === 'function' ? now : () => Date.now();
  const writer = typeof writerId === 'string' && writerId.length > 0 ? encodeUri(writerId) : null;

  const seriesPrefix = (uri) => `${root}${encodeUri(uri)}/`;
  // Version id = the key suffix: `<ts>` (single-writer) or `<ts>-<writer>`.
  const versionId = (ts) => (writer ? `${ts}-${writer}` : String(ts));
  const keyFor = (uri, id) => `${seriesPrefix(uri)}${id}`;
  const parseId = (id) => {
    const m = /^(\d+)(?:-(.*))?$/.exec(String(id));
    if (!m) return null;
    const ts = Number(m[1]);
    return Number.isFinite(ts) ? { ts, writer: m[2] ?? null } : null;
  };

  /** Versionable = caller opt-out + never version the version store itself (no versions-of-versions). */
  function versionable(uri) {
    if (typeof uri !== 'string' || uri.length === 0) return false;
    if (uri.startsWith(root)) return false;
    return shouldVersion(uri) !== false;
  }

  /** Series entries newest-first: [{ key, id, ts, writer }]. Cheap — parses the key suffix, no record reads. */
  async function seriesEntries(uri) {
    const prefix = seriesPrefix(uri);
    const keys = await backend.list(prefix);
    const out = [];
    for (const k of keys) {
      const id = k.slice(prefix.length);
      const parsed = parseId(id);
      if (parsed) out.push({ key: k, id, ts: parsed.ts, writer: parsed.writer });
    }
    out.sort((a, b) => (b.ts - a.ts) || String(b.writer).localeCompare(String(a.writer)));
    return out;
  }

  /** Resolve a version by numeric `ts` (newest match wins) or full string id (exact). */
  async function findEntry(uri, tsOrId) {
    const asString = String(tsOrId);
    if (asString.includes('-')) {
      const key = keyFor(uri, asString);
      const rec = await readRecord(key);
      return rec ? { key, rec } : null;
    }
    const wanted = Number(tsOrId);
    if (!Number.isFinite(wanted)) return null;
    const entries = await seriesEntries(uri);
    const hit = entries.find((e) => e.ts === wanted);
    if (!hit) return null;
    const rec = await readRecord(hit.key);
    return rec ? { key: hit.key, rec } : null;
  }

  /** Unwrap the stored record from the backend's opaque `{ bytes }` envelope. */
  async function readRecord(key) {
    const rec = await backend.get(key);
    return rec ? rec.bytes : null;
  }

  async function capture(uri, contentIn, opts = {}) {
    if (!versionable(uri)) return { captured: false, reason: 'NOT_VERSIONABLE' };
    const content = contentIn == null ? '' : contentIn;

    const entries = await seriesEntries(uri);
    if (entries.length === 0 && isEmptyContent(content)) {
      return { captured: false, reason: 'EMPTY_FIRST_VERSION' };
    }

    const sha = await hash(content);
    const requested = Number.isFinite(opts.now) ? opts.now : clock();

    const newest = entries[0] ? await readRecord(entries[0].key) : null;
    if (newest && newest.sha256 === sha && (requested - newest.ts) < debounceMs) {
      return { captured: false, reason: 'DEBOUNCED' };
    }

    // Strictly-increasing ts per series (same-millisecond bump); the writer
    // suffix keeps CONCURRENT writers on a shared backend collision-free.
    const ts = entries[0] && requested <= entries[0].ts ? entries[0].ts + 1 : requested;
    const id = versionId(ts);
    const size = byteLength(content);
    await backend.put(keyFor(uri, id), {
      ts, sha256: sha, size, content,
      ...(writer ? { writer } : {}),
    });

    const prune = await pruneSeries(uri);
    return { captured: true, ts, id, sha256: sha, size, prune };
  }

  /** Enforce the per-series retention cap (oldest-first eviction). */
  async function pruneSeries(uri) {
    const entries = await seriesEntries(uri); // newest-first
    let versionsRemoved = 0;
    let bytesFreed = 0;
    if (entries.length > perSeries) {
      for (const e of entries.slice(perSeries)) {
        const rec = await readRecord(e.key);
        try {
          await backend.delete(e.key);
          versionsRemoved += 1;
          if (rec && Number.isFinite(rec.size)) bytesFreed += rec.size;
        } catch { /* best-effort — never break the write path */ }
      }
    }
    return { versionsRemoved, bytesFreed };
  }

  /**
   * All versions of `uri`, newest-first: [{ ts, sha256, size }]. Pass
   * `{ withContent: true }` to include each snapshot's `content` inline (for
   * value-inline consumers like the circle object stores) — heavier, opt-in.
   */
  async function list(uri, { withContent = false } = {}) {
    if (!versionable(uri)) return [];
    const entries = await seriesEntries(uri);
    const out = [];
    for (const e of entries) {
      const rec = await readRecord(e.key);
      const base = rec
        ? { ts: rec.ts, id: e.id, sha256: rec.sha256, size: rec.size }
        : { ts: e.ts, id: e.id, sha256: '', size: 0 };
      if (e.writer != null) base.writer = e.writer;
      out.push(withContent ? { ...base, content: rec ? rec.content : null } : base);
    }
    return out;
  }

  /** Raw content of one snapshot — by numeric ts or full id. Throws VERSION_NOT_FOUND when absent. */
  async function read(uri, tsOrId) {
    const hit = await findEntry(uri, tsOrId);
    if (!hit) {
      const e = new Error(`versionStore.read: no snapshot at ${tsOrId} for ${uri}`);
      e.code = 'VERSION_NOT_FOUND';
      throw e;
    }
    return hit.rec.content;
  }

  /**
   * Restore the snapshot at `ts` to the live resource. Captures the CURRENT
   * live content first (via readLive) so a wrong restore is itself undoable,
   * then writes the target content back (via writeLive).
   */
  async function restore(uri, tsOrId) {
    if (!versionable(uri)) {
      const e = new Error(`versionStore.restore: not versionable: ${uri}`);
      e.code = 'NOT_VERSIONABLE';
      throw e;
    }
    const hit = await findEntry(uri, tsOrId);
    if (!hit) {
      const e = new Error(`versionStore.restore: no snapshot at ${tsOrId} for ${uri}`);
      e.code = 'VERSION_NOT_FOUND';
      throw e;
    }
    const target = hit.rec;

    let snapshotMsBeforeRestore = null;
    if (typeof readLive === 'function') {
      let current;
      try {
        current = await readLive(uri);
      } catch (err) {
        const e = new Error(`versionStore.restore: failed to read current content: ${err.message}`);
        e.code = 'READ_FAILED';
        throw e;
      }
      const pre = await capture(uri, current ?? '', { now: clock() });
      snapshotMsBeforeRestore = pre.captured ? pre.ts : null;
    }
    if (typeof writeLive === 'function') {
      await writeLive(uri, target.content);
    }
    return { uri, restoredFromMs: target.ts, snapshotMsBeforeRestore };
  }

  /** Drop the whole history for `uri`. Returns the count of snapshots removed. */
  async function drop(uri) {
    const entries = await seriesEntries(uri);
    let deleted = 0;
    for (const e of entries) {
      try { await backend.delete(e.key); deleted += 1; } catch { /* best-effort */ }
    }
    return deleted;
  }

  /** Every series with at least one snapshot, newest-first: [{ uri, latestMs, count }]. */
  async function listSeries() {
    const keys = await backend.list(root);
    const byUri = new Map();
    for (const k of keys) {
      const rest = k.slice(root.length);
      const slash = rest.indexOf('/'); // encodeURIComponent(uri) contains no literal '/'
      if (slash < 0) continue;
      const uri = decodeURIComponent(rest.slice(0, slash));
      const parsed = parseId(rest.slice(slash + 1));
      if (!parsed) continue;
      const cur = byUri.get(uri) ?? { uri, latestMs: 0, count: 0 };
      cur.count += 1;
      if (parsed.ts > cur.latestMs) cur.latestMs = parsed.ts;
      byUri.set(uri, cur);
    }
    return [...byUri.values()].sort((a, b) => b.latestMs - a.latestMs);
  }

  return {
    capture,
    list,
    read,
    restore,
    // PRIVILEGED ops (PLAN, decision B): drop/prune erase history — they
    // are for the OWNER's composition/retention code only and must never be
    // wired into a grantable skill/manifest op. The history-immutability
    // guard asserts no skill surface reaches them.
    drop,
    prune: ({ uri } = {}) => pruneSeries(uri),
    listSeries,
    isVersionable: versionable,
    /** The history key prefix — lets the pod REFUSE direct writes/deletes
     *  under it (the 4b substrate-level guard). */
    get versionsRoot() { return root; },
  };
}
