/**
 * createBackend — size-routing StorageBackend.
 *
 * Composite backend that picks `AsBackend` for small writes
 * (< `fsThresholdBytes`) and `FsBackend` for large ones. The two
 * underlying stores share the same key namespace but each key lives
 * in exactly one backend. A `_locations` map remembers which key
 * lives where for subsequent reads + cross-backend migration.
 *
 * Migration: when an update crosses the threshold in either
 * direction, we write the new payload to the target backend, then
 * delete the old entry — net effect is atomic from the caller's
 * point of view (`get` reads from the new location once `put`
 * resolves).
 *
 * Standardisation Phase 51.4.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { createAsBackend } from './AsBackend.js';
import { createFsBackend } from './FsBackend.js';
import { estimateBytes }   from './_utils.js';

// Parameter register (#36) — size-routing backend threshold (scope:device, kind:internal).
const DEFAULT_FS_THRESHOLD_BYTES = param({ key: 'rnBackend.fsThresholdBytes', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 * 1024 });

/**
 * @param {object} opts
 * @param {object} opts.FileSystem
 * @param {object} opts.AsyncStorage
 * @param {string} opts.rootDir
 * @param {string} [opts.scope='pp']
 * @param {number} [opts.fsThresholdBytes=4096]
 * @param {number} [opts.pollIntervalMs=0]
 */
export function createBackend({
  FileSystem,
  AsyncStorage,
  rootDir,
  scope = 'pp',
  fsThresholdBytes = DEFAULT_FS_THRESHOLD_BYTES,
  pollIntervalMs = 0,
} = {}) {
  const asBackend = createAsBackend({ AsyncStorage, scope });
  const fsBackend = createFsBackend({
    FileSystem,
    rootDir,
    scope,
    pollIntervalMs,
  });

  /** @type {Map<string, 'as'|'fs'>} */
  const locations = new Map();

  const generalSubscribers = new Set();
  const prefixSubscribers  = new Map();
  const dirtySubscribers   = new Set();

  // Fan inner-backend events out as our own. We dedupe so a migration
  // (put-then-delete) doesn't spam subscribers with both events.
  let suppressNextDelete = null;   // key to swallow once

  function _fanOut(event) {
    for (const cb of generalSubscribers) { try { cb(event); } catch { /* swallow */ } }
    for (const [prefix, subs] of prefixSubscribers) {
      if (event.key.startsWith(prefix)) {
        for (const cb of subs) { try { cb(event); } catch { /* swallow */ } }
      }
    }
  }
  function _fanOutDirty(event) {
    for (const cb of dirtySubscribers) { try { cb(event); } catch { /* swallow */ } }
  }

  // Hook inner backends.
  asBackend.subscribe('', (e) => {
    if (e.op === 'delete' && suppressNextDelete === e.key) {
      suppressNextDelete = null;
      return;
    }
    _fanOut(e);
  });
  fsBackend.subscribe('', (e) => {
    if (e.op === 'delete' && suppressNextDelete === e.key) {
      suppressNextDelete = null;
      return;
    }
    _fanOut(e);
  });
  asBackend.subscribeDirty(_fanOutDirty);
  fsBackend.subscribeDirty(_fanOutDirty);

  function _pickBackend(value) {
    return estimateBytes(value) >= fsThresholdBytes ? 'fs' : 'as';
  }

  function _backendFor(loc) { return loc === 'fs' ? fsBackend : asBackend; }

  async function get(key) {
    const loc = locations.get(key);
    if (loc) return _backendFor(loc).get(key);
    // Unknown — probe both (FS first, since it's the slower path; the
    // miss-then-AS pattern matches the put-routing default).
    const fromFs = await fsBackend.get(key);
    if (fromFs) {
      locations.set(key, 'fs');
      return fromFs;
    }
    const fromAs = await asBackend.get(key);
    if (fromAs) {
      locations.set(key, 'as');
      return fromAs;
    }
    return null;
  }

  async function put(key, bytes, etag) {
    const target = _pickBackend(bytes);
    const prevLoc = locations.get(key);
    const etagResult = await _backendFor(target).put(key, bytes, etag);
    locations.set(key, target);
    if (prevLoc && prevLoc !== target) {
      // Migration — drop the stale copy from the other backend.
      suppressNextDelete = key;
      try { await _backendFor(prevLoc).delete(key); }
      catch { /* swallow — best-effort cleanup */ }
    }
    return etagResult;
  }

  async function del(key) {
    const loc = locations.get(key);
    if (loc) {
      await _backendFor(loc).delete(key);
      locations.delete(key);
      return;
    }
    // Unknown — try both, in parallel.
    await Promise.all([
      asBackend.delete(key).catch(() => {}),
      fsBackend.delete(key).catch(() => {}),
    ]);
  }

  async function list(prefix) {
    const [asKeys, fsKeys] = await Promise.all([
      asBackend.list(prefix),
      fsBackend.list(prefix),
    ]);
    const set = new Set([...asKeys, ...fsKeys]);
    // Refresh location memo from the listing for hot keys.
    for (const k of asKeys) if (!locations.has(k)) locations.set(k, 'as');
    for (const k of fsKeys) if (!locations.has(k)) locations.set(k, 'fs');
    return [...set].sort();
  }

  function subscribe(prefix, cb) {
    if (typeof prefix !== 'string') {
      generalSubscribers.add(prefix);
      return () => { generalSubscribers.delete(prefix); };
    }
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('subscribe: callback is required'),
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
  }

  async function listDirty() {
    const [a, b] = await Promise.all([asBackend.listDirty(), fsBackend.listDirty()]);
    return [...new Set([...a, ...b])].sort();
  }

  function subscribeDirty(cb) {
    if (typeof cb !== 'function') {
      throw Object.assign(
        new Error('subscribeDirty: callback is required'),
        { code: 'INVALID_ARGUMENT' },
      );
    }
    dirtySubscribers.add(cb);
    return () => { dirtySubscribers.delete(cb); };
  }

  return {
    get,
    put,
    delete: del,
    list,
    subscribe,
    listDirty,
    subscribeDirty,

    // V1 hooks delegate to whichever backend holds the key. After a
    // restart `locations` may be empty — `list()` repopulates it
    // lazily; for an unknown key we mark on AS (it's the safer
    // default for small flag-only metadata) and the backend persists
    // the marker.
    async _markDirty(key) {
      let loc = locations.get(key);
      if (!loc) loc = 'as';
      await _backendFor(loc)._markDirty(key);
    },
    async _markClean(key) {
      // Clean on BOTH if location unknown — survives the rare case
      // where the marker outlived the resource.
      const loc = locations.get(key);
      if (loc) {
        await _backendFor(loc)._markClean(key);
      } else {
        await Promise.all([
          asBackend._markClean(key).catch(() => {}),
          fsBackend._markClean(key).catch(() => {}),
        ]);
      }
    },

    _close() { fsBackend._close?.(); },
    get _kind()            { return 'createBackend'; },
    get _fsThresholdBytes(){ return fsThresholdBytes; },
    get _locations()       { return new Map(locations); },
    get _asBackend()       { return asBackend; },
    get _fsBackend()       { return fsBackend; },
  };
}
