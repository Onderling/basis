/**
 * FilePersist — Node fs adapter for `CachingDataSource`'s local
 * cache, persisting the in-memory `Map` to a JSON file.
 *
 * Stoop V1 closed-beta gap: until this lands, killing the Node
 * process wipes the user's local state.  This adapter survives
 * restarts: `await load()` rebuilds the Map from disk; every write
 * triggers a debounced `save()`.
 *
 * Surface:
 *   - `attachTo(cache, { saveDelayMs? })` — wires the adapter to a
 *     CachingDataSource: `cache._localStoreSet` is wrapped to fire a
 *     debounced save on every change.  Returns a `detach()` fn.
 *
 * The adapter does NOT understand item shape — it persists a generic
 * Map<string, any>.  Callers that need encryption / versioning wrap
 * `load`/`save`.
 *
 * **Substrate candidate (rule of two — first consumer):** when a
 * second app's `CachingDataSource` needs persistence, lift this
 * alongside the existing `CachingDataSource` candidate into
 * `@onderling/local-store`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

import { trackPendingSave } from '@onderling/local-store';

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export class FilePersist {
  #path;
  #saveDelayMs;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
  #untrack = null;
  /** Most recent saved-to-disk snapshot (for diffing / no-op skip). */
  #lastSerialised = null;

  /**
   * @param {object} args
   * @param {string} args.path                 absolute file path (created on first save)
   * @param {number} [args.saveDelayMs=200]    debounce window (ms)
   */
  constructor({ path, saveDelayMs = 200 } = {}) {
    if (typeof path !== 'string' || !path) throw new TypeError('FilePersist: path required');
    this.#path        = path;
    this.#saveDelayMs = saveDelayMs;
  }

  /**
   * Read the JSON file (if any) and return the resulting Map.
   * Empty / missing file → empty Map.  Corrupt JSON → empty Map +
   * the error is non-fatal (log, don't throw).
   *
   * @returns {Promise<Map<string, any>>}
   */
  async load() {
    try {
      const raw = await readFile(this.#path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return new Map();
      this.#lastSerialised = raw;
      return new Map(Object.entries(parsed));
    } catch (err) {
      if (err && err.code === 'ENOENT') return new Map();
      // Corrupt file: surface via `error` event when wired through a
      // CachingDataSource; standalone callers see no return value
      // distinction (empty Map).  Apps that want strict mode can read
      // the file themselves first.
      return new Map();
    }
  }

  /**
   * Write a Map to disk atomically (write to `.tmp`, rename).
   * Debounced if called via `scheduleSave`; direct `save` is sync-write.
   *
   * @param {Map<string, any>} map
   */
  async save(map) {
    const obj = Object.fromEntries(map);
    const serialised = JSON.stringify(obj);
    if (serialised === this.#lastSerialised) return;       // no-op skip
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, serialised, 'utf-8');
    await rename(tmp, this.#path);
    this.#lastSerialised = serialised;
  }

  /**
   * Schedule a debounced save.  Coalesces bursts of writes into one
   * fsync per debounce window.
   *
   * @param {Map<string, any>} map
   */
  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#untrack?.();
    // Snapshot inside the timer fires so a write during debounce
    // delay is included in the eventual save.
    const run = () => this.save(map).catch(() => { /* swallow — caller's onError handler is upstream */ });
    // tracked while it waits: a shell flushes it at once when the page or the app goes away
    this.#untrack = trackPendingSave(async () => {
      if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
      this.#untrack = null;
      await run();
    });
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.#untrack?.(); this.#untrack = null;
      run();
    }, this.#saveDelayMs);
  }

  /** Force any pending debounced save to flush now. */
  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    this.#untrack?.(); this.#untrack = null;
    await this.save(map);
  }

  /** Cancel any pending debounced save without saving. */
  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    this.#untrack?.(); this.#untrack = null;
  }
}
