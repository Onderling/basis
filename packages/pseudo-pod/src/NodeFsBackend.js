/**
 * NodeFsBackend — a persistent `StorageBackend` backed by the Node
 * filesystem.
 *
 * ⚠️ NODE-ONLY (per the portability convention, the filename carries
 * `Node`). This is the *only* `node:`-coupled file in `@onderling/pseudo-pod`
 * — keep it that way; never import `node:fs` into `PseudoPod.js`.
 *
 * It is a **general-purpose, opt-in** sibling to `MemoryBackend`: any
 * Node consumer that needs the pseudo-pod's local store (and especially
 * the cache-mode write-through queue) to **survive process restart**
 * uses it. The first consumer is the Folio desktop daemon (Phase B),
 * but nothing here is Folio-specific. Browser consumers use an
 * IndexedDB backend instead; React Native uses its AsyncStorage/SQLite
 * backend. None of those touch this file.
 *
 * Contract: a drop-in `StorageBackend` (see `StorageBackend.js`) — the
 * `get/put/delete/list` + in-process `subscribe/listDirty/
 * subscribeDirty` surface, with semantics identical to `MemoryBackend`
 * (new key `_v=1`, increment on put unless the caller pins `_v`;
 * caller-supplied etag preserved, else a fresh one is assigned).
 *
 * Persistence model:
 *   - One JSON record file per key, named `sha256(key).json` (so keys
 *     containing `:` / `/` / long URIs are filename- and length-safe;
 *     the real key is stored inside the record).
 *   - Atomic writes (write to a unique `.tmp`, then `rename`) so a
 *     crash mid-write can't corrupt a record.
 *   - `bytes` may be any value (string, Uint8Array/Buffer, or an
 *     object that itself contains binary — e.g. the write-through
 *     queue's `{uri,bytes,…}` entries). A recursive tagging
 *     (de)serializer round-trips binary anywhere in the value.
 *   - `_v` is stored in the record, so the Lamport counter survives
 *     restart (the whole point).
 *
 * V1 simplifications (documented, deliberate):
 *   - `subscribe`/`subscribeDirty`/the dirty-set are in-process only
 *     (a single Folio daemon re-attaches subscribers on boot; the
 *     durable signal is the persisted queue records themselves).
 *   - `list(prefix)` is an O(n) directory scan — fine at Folio note
 *     scale; an index is future work if a large-N consumer appears.
 *   - Single-writer assumption: one process per `dir`. Concurrent
 *     writers are out of scope (the Folio daemon is single-instance).
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile, rename, unlink, mkdir, readdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';

const U8_TAG = '__pp_u8__';

/** Recursively tag Uint8Array/Buffer/ArrayBuffer for JSON storage. */
function encodeValue(value) {
  if (value == null) return value;
  if (value instanceof Uint8Array) {
    return { [U8_TAG]: Buffer.from(value).toString('base64') };
  }
  if (value instanceof ArrayBuffer) {
    return { [U8_TAG]: Buffer.from(new Uint8Array(value)).toString('base64') };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = encodeValue(value[k]);
    return out;
  }
  return value;
}

/** Inverse of encodeValue — revives tagged binary back to Uint8Array. */
function decodeValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeValue);
  if (typeof value[U8_TAG] === 'string') {
    return new Uint8Array(Buffer.from(value[U8_TAG], 'base64'));
  }
  const out = {};
  for (const k of Object.keys(value)) out[k] = decodeValue(value[k]);
  return out;
}

const fileFor = (dir, key) =>
  join(dir, createHash('sha256').update(key).digest('hex') + '.json');

/**
 * Create a persistent `StorageBackend` backed by the Node filesystem: one JSON record per key
 * (`sha256(key).json` under `dir`, atomic write-to-tmp-then-rename) with `MemoryBackend`-identical
 * get/put/delete/list + subscribe semantics. Values round-trip binary (Uint8Array/ArrayBuffer are
 * tagged for JSON) and the `_v` counter survives restart; subscriptions and the dirty-set are
 * in-process only. Node-only — the single `node:`-coupled file in this package.
 *
 * @param {object} opts
 * @param {string} opts.dir — directory the records live in (created on first write).
 * @returns {import('./StorageBackend.js').StorageBackend & { _size: () => Promise<number> }}
 */
export function createNodeFsBackend({ dir } = {}) {
  if (typeof dir !== 'string' || dir.length === 0) {
    throw Object.assign(
      new Error('createNodeFsBackend: `dir` (string) is required'),
      { code: 'INVALID_ARGUMENT' },
    );
  }

  /** @type {Set<(e: object) => void>} */
  const generalSubscribers = new Set();
  /** @type {Map<string, Set<(e: object) => void>>} */
  const prefixSubscribers = new Map();
  /** @type {Set<(e: object) => void>} */
  const dirtySubscribers = new Set();
  /** @type {Set<string>} */
  const dirty = new Set();

  let etagCounter = 0;
  const nextEtag = () =>
    `"fs-${Date.now().toString(36)}-${(++etagCounter).toString(36)}-${Math.random().toString(36).slice(2, 8)}"`;   // random: two processes mint in one ms

  let dirReady = false;
  async function ensureDir() {
    if (dirReady) return;
    await mkdir(dir, { recursive: true });
    dirReady = true;
  }

  function _fanOut(event) {
    for (const cb of generalSubscribers) {
      try { cb(event); } catch (_err) { /* swallow — substrate-internal */ }
    }
    for (const [prefix, subs] of prefixSubscribers) {
      if (event.key.startsWith(prefix)) {
        for (const cb of subs) {
          try { cb(event); } catch (_err) { /* swallow */ }
        }
      }
    }
  }

  function _fanOutDirty(event) {
    for (const cb of dirtySubscribers) {
      try { cb(event); } catch (_err) { /* swallow */ }
    }
  }

  async function _readRecord(key) {
    try {
      const raw = await readFile(fileFor(dir, key), 'utf-8');
      return JSON.parse(raw);
    } catch (err) {
      if (err && err.code === 'ENOENT') return null;
      // Corrupt record → treat as a miss (mirrors MemoryBackend's
      // "absent key" rather than throwing into the substrate).
      return null;
    }
  }

  return {
    async get(key) {
      const rec = await _readRecord(key);
      if (!rec) return null;
      return {
        bytes: decodeValue(rec.val),
        ...(rec.etag != null ? { etag: rec.etag } : {}),
        ...(typeof rec.v === 'number' ? { _v: rec.v } : {}),
      };
    },

    async put(key, bytes, etag, _v) {
      await ensureDir();
      const prev = await _readRecord(key);
      const finalEtag = etag ?? nextEtag();
      const finalV = typeof _v === 'number'
        ? _v
        : ((prev && typeof prev.v === 'number' ? prev.v : 0) + 1);
      const record = { key, etag: finalEtag, v: finalV, val: encodeValue(bytes) };

      const target = fileFor(dir, key);
      const tmp = `${target}.${process.pid}.${(++etagCounter).toString(36)}.tmp`;
      await writeFile(tmp, JSON.stringify(record), 'utf-8');
      await rename(tmp, target);

      _fanOut({ op: 'put', key, etag: finalEtag, _v: finalV });
      return { etag: finalEtag, _v: finalV };
    },

    /**
     * Compare-and-swap across PROCESSES on this directory (the box runs more than one): compare and write under an
     * exclusive lock file (`open(…, 'wx')`), so two processes cannot both read the same etag and both write. A lock
     * older than 10 s is a crashed holder's: moved aside atomically, then taken.
     */
    async putIf(key, bytes, ifMatch) {
      await ensureDir();
      const target = fileFor(dir, key);
      const lock = `${target}.lock`;
      let fh = null;
      for (let i = 0; i < 200 && !fh; i++) {
        try { fh = await open(lock, 'wx'); }
        catch (err) {
          if (err?.code !== 'EEXIST') throw err;
          // a crashed holder's lock is moved aside, not unlinked: rename is atomic, so of two contenders that both saw it
          // stale only one moves it — the other's rename fails, and it never removes the winner's fresh lock
          try { const st = await stat(lock); if (Date.now() - st.mtimeMs > 10_000) await rename(lock, `${lock}.stale.${process.pid}.${Date.now()}`).catch(() => {}); } catch { /* gone already */ }
          await new Promise((r) => setTimeout(r, 5 + Math.floor(Math.random() * 10)));
        }
      }
      if (!fh) throw Object.assign(new Error(`NodeFsBackend: could not lock "${key}"`), { code: 'LOCKED' });
      try {
        const prev = await _readRecord(key);
        if ((prev?.etag ?? null) !== ifMatch) return { conflict: true };
        const finalEtag = nextEtag();
        const finalV = (prev && typeof prev.v === 'number' ? prev.v : 0) + 1;
        const tmp = `${target}.${process.pid}.${(++etagCounter).toString(36)}.tmp`;
        await writeFile(tmp, JSON.stringify({ key, etag: finalEtag, v: finalV, val: encodeValue(bytes) }), 'utf-8');
        await rename(tmp, target);
        _fanOut({ op: 'put', key, etag: finalEtag, _v: finalV });
        return { etag: finalEtag, _v: finalV };
      } finally {
        await fh.close().catch(() => {});
        await unlink(lock).catch(() => {});
      }
    },

    async delete(key) {
      try {
        await unlink(fileFor(dir, key));
        _fanOut({ op: 'delete', key });
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
      }
      if (dirty.has(key)) {
        dirty.delete(key);
        _fanOutDirty({ op: 'clean', key });
      }
    },

    async list(prefix) {
      let files;
      try {
        files = await readdir(dir);
      } catch (err) {
        if (err && err.code === 'ENOENT') return [];
        throw err;
      }
      const out = [];
      for (const f of files) {
        if (!f.endsWith('.json')) continue;       // skip *.tmp / stray files
        try {
          const rec = JSON.parse(await readFile(join(dir, f), 'utf-8'));
          if (typeof rec.key === 'string' && rec.key.startsWith(prefix)) {
            out.push(rec.key);
          }
        } catch (_err) { /* skip unreadable/corrupt record */ }
      }
      out.sort();
      return out;
    },

    subscribe(prefix, cb) {
      if (typeof prefix !== 'string') {
        generalSubscribers.add(prefix);          // subscribe(cb) shorthand
        return () => { generalSubscribers.delete(prefix); };
      }
      if (typeof cb !== 'function') {
        throw Object.assign(
          new Error('subscribe: callback must be a function'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      let subs = prefixSubscribers.get(prefix);
      if (!subs) { subs = new Set(); prefixSubscribers.set(prefix, subs); }
      subs.add(cb);
      return () => {
        subs.delete(cb);
        if (subs.size === 0) prefixSubscribers.delete(prefix);
      };
    },

    async listDirty() {
      return [...dirty].sort();
    },

    subscribeDirty(cb) {
      if (typeof cb !== 'function') {
        throw Object.assign(
          new Error('subscribeDirty: callback must be a function'),
          { code: 'INVALID_ARGUMENT' },
        );
      }
      dirtySubscribers.add(cb);
      return () => { dirtySubscribers.delete(cb); };
    },

    // ── Test/internal helpers (parity with MemoryBackend) ──────────
    async _size() {
      try {
        return (await readdir(dir)).filter((f) => f.endsWith('.json')).length;
      } catch { return 0; }
    },
    _markDirty(key) {
      if (!dirty.has(key)) {
        dirty.add(key);
        _fanOutDirty({ op: 'dirty', key });
      }
    },
    _markClean(key) {
      if (dirty.has(key)) {
        dirty.delete(key);
        _fanOutDirty({ op: 'clean', key });
      }
    },
  };
}
