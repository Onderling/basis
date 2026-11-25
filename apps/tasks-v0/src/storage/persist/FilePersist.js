/**
 * FilePersist — Node fs adapter for tasks-v0's `CachingDataSource`
 * local cache.
 *
 * Identical surface + semantics to `apps/pinboard/src/lib/FilePersist.js`.
 * Copied (not imported) to avoid an app→app dependency.  Substrate-
 * extraction candidate — lift the three adapters + persistPicker into
 * `@onderling/local-store` once we have a third consumer.
 */

import { mapSnapshotGate } from '@onderling/local-store';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

export class FilePersist {
  #path;
  #saveDelayMs;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
  /** Most recent saved-to-disk snapshot (for diffing / no-op skip). */
  #lastSerialised = null;
  #gate = null;

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
   * @returns {Promise<Map<string, any>>}
   */
  async load() {
    let raw;
    try { raw = await readFile(this.#path, 'utf-8'); }
    catch (err) { return err?.code === 'ENOENT' ? this.#gateOf().read(null) : this.#gateOf().readFailed(); }
    const map = this.#gateOf().read(raw);   // not readable → empty here, and every save refused
    if (!this.#gateOf().notReadable) this.#lastSerialised = raw;
    return map;
  }

  /** The snapshot's format and the refusal to save over one this build could not read (`mapSnapshotGate`). */
  #gateOf() { return (this.#gate ??= mapSnapshotGate(this.#path)); }

  /**
   * Atomic write (write to `.tmp`, rename).
   *
   * @param {Map<string, any>} map
   */
  async save(map) {
    const serialised = this.#gateOf().encode(map);
    if (serialised == null) return;   // not readable at load: nothing is saved over it
    if (serialised === this.#lastSerialised) return;
    await mkdir(dirname(this.#path), { recursive: true });
    const tmp = `${this.#path}.tmp`;
    await writeFile(tmp, serialised, 'utf-8');
    await rename(tmp, this.#path);
    this.#lastSerialised = serialised;
  }

  /**
   * Schedule a debounced save.
   *
   * @param {Map<string, any>} map
   */
  scheduleSave(map) {
    if (this.#pendingTimer) clearTimeout(this.#pendingTimer);
    this.#pendingTimer = setTimeout(() => {
      this.#pendingTimer = null;
      this.save(map).catch(() => { /* swallow — best-effort */ });
    }, this.#saveDelayMs);
  }

  /** Force any pending debounced save to flush now. */
  async flush(map) {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
    await this.save(map);
  }

  /** Cancel any pending debounced save without saving. */
  cancel() {
    if (this.#pendingTimer) { clearTimeout(this.#pendingTimer); this.#pendingTimer = null; }
  }
}
