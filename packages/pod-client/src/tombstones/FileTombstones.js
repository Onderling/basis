/**
 * FileTombstones — Node-side `TombstoneStore` backed by a single JSON file.
 *
 * Persistent across `PodClient` restarts.  Writes are atomic: data is
 * written to `<path>.tmp` then renamed onto `<path>`.
 *
 * Default path: `os.tmpdir() + '/onderling-tombstones.json'`.  Pass an
 * explicit `{ path }` for production deployments — `os.tmpdir()` may be
 * cleaned by the OS.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { TombstoneStore } from '../TombstoneStore.js';

const DEFAULT_FILENAME = 'onderling-tombstones.json';

/**
 * Node-side `TombstoneStore` backed by a single JSON file, persistent across `PodClient` restarts.
 * Writes are atomic (written to `<path>.tmp`, then renamed onto `<path>`). Defaults to
 * `os.tmpdir() + '/onderling-tombstones.json'`; pass an explicit `{ path }` for production use.
 */
export class FileTombstones extends TombstoneStore {
  #path;
  #map = null;
  #loadPromise = null;

  /**
   * @param {object} [opts]
   * @param {string} [opts.path]  — absolute path; defaults to
   *   `os.tmpdir() + '/onderling-tombstones.json'`.
   */
  constructor({ path: filePath } = {}) {
    super();
    this.#path = filePath ?? path.join(os.tmpdir(), DEFAULT_FILENAME);
  }

  /** Resolved path for inspection. */
  get path() { return this.#path; }

  async #load() {
    if (this.#map) return this.#map;
    if (!this.#loadPromise) {
      this.#loadPromise = (async () => {
        try {
          const raw = await fs.readFile(this.#path, 'utf8');
          const obj = JSON.parse(raw);
          // Shape on disk: { [uri]: { at: number } }
          this.#map = new Map(Object.entries(obj || {}));
        } catch (err) {
          if (err?.code === 'ENOENT') {
            this.#map = new Map();
          } else if (err instanceof SyntaxError) {
            // Corrupt file — start fresh; better than throwing on every call.
            this.#map = new Map();
          } else {
            throw err;
          }
        }
        return this.#map;
      })();
    }
    return this.#loadPromise;
  }

  async #flush() {
    const m   = this.#map;
    const obj = {};
    for (const [k, v] of m) obj[k] = v;
    const json = JSON.stringify(obj);
    const tmp  = `${this.#path}.tmp`;
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, this.#path);
  }

  async add(uri, { at } = {}) {
    const m = await this.#load();
    m.set(uri, { at: at ?? Date.now() });
    await this.#flush();
  }

  async has(uri) {
    const m = await this.#load();
    return m.has(uri);
  }

  async remove(uri) {
    const m = await this.#load();
    if (!m.has(uri)) return;
    m.delete(uri);
    await this.#flush();
  }

  async list() {
    const m = await this.#load();
    return Array.from(m.entries()).map(([uri, v]) => ({ uri, at: v.at }));
  }

  async close() {
    // Drop the in-memory cache so a subsequent operation re-reads from disk.
    this.#map        = null;
    this.#loadPromise = null;
  }
}
