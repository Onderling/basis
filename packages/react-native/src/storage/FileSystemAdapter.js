/**
 * FileSystemAdapter — RN persistence for `CachingDataSource`'s local
 * cache, persisting the in-memory `Map` to a JSON file via
 * `expo-file-system`.
 *
 * Pinboard V3 Phase 40.4 (2026-05-08): the mobile counterpart to
 * `apps/pinboard/src/lib/FilePersist.js` (which uses `node:fs/promises`).
 * Same API surface (`load`, `save`, `scheduleSave`, `flush`, `cancel`)
 * so app code that previously referenced `FilePersist` can switch by
 * swapping the constructor.
 *
 * **Peer dependency:** `expo-file-system`. The adapter takes the
 * namespace import as a constructor argument so the substrate stays
 * import-time-decoupled from the Expo module (matters for non-RN
 * consumers under unit-test runners; the substrate's barrel can be
 * loaded without requiring expo-file-system to resolve).
 *
 * Atomicity: write to `<path>.tmp`, then move-async over `<path>`.
 * `expo-file-system.moveAsync` is the atomic-rename primitive.
 *
 * The adapter does NOT understand item shape — it persists a generic
 * Map<string, any> via JSON. Callers that need encryption / versioning
 * wrap `load` / `save`.
 */

export class FileSystemAdapter {
  #FileSystem;
  #path;
  #saveDelayMs;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #pendingTimer = null;
  /** Most recent saved-to-disk snapshot (for diffing / no-op skip). */
  #lastSerialised = null;

  /**
   * @param {object} args
   * @param {object} args.FileSystem            namespace import of `expo-file-system`
   * @param {string} args.path                  absolute file URI under `documentDirectory`
   *                                              (e.g. `${FileSystem.documentDirectory}pinboard/state.json`).
   * @param {number} [args.saveDelayMs=200]     debounce window (ms)
   */
  constructor({ FileSystem, path, saveDelayMs = 200 } = {}) {
    if (!FileSystem) throw new TypeError('FileSystemAdapter: FileSystem (expo-file-system) required');
    if (typeof path !== 'string' || !path) throw new TypeError('FileSystemAdapter: path required');
    this.#FileSystem  = FileSystem;
    this.#path        = path;
    this.#saveDelayMs = saveDelayMs;
  }

  /**
   * Read the JSON file (if any) and return the resulting Map.
   * Empty / missing file → empty Map.  Corrupt JSON → empty Map.
   *
   * @returns {Promise<Map<string, any>>}
   */
  async load() {
    try {
      const info = await this.#FileSystem.getInfoAsync(this.#path);
      if (!info?.exists) return new Map();
      const raw = await this.#FileSystem.readAsStringAsync(this.#path, {
        encoding: this.#FileSystem.EncodingType?.UTF8 ?? 'utf8',
      });
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return new Map();
      this.#lastSerialised = raw;
      return new Map(Object.entries(parsed));
    } catch {
      // Corrupt file or read error — keep silent here; the
      // CachingDataSource emits its own error events when wired.
      return new Map();
    }
  }

  /**
   * Write a Map to disk atomically (write to `.tmp`, then move).
   *
   * @param {Map<string, any>} map
   */
  async save(map) {
    const obj = Object.fromEntries(map);
    const serialised = JSON.stringify(obj);
    if (serialised === this.#lastSerialised) return;       // no-op skip

    // Ensure the parent directory exists.
    const parent = _dirname(this.#path);
    if (parent) {
      try {
        await this.#FileSystem.makeDirectoryAsync(parent, { intermediates: true });
      } catch { /* exists or unavailable — atomic write below either succeeds or surfaces */ }
    }

    const tmp = `${this.#path}.tmp`;
    await this.#FileSystem.writeAsStringAsync(tmp, serialised, {
      encoding: this.#FileSystem.EncodingType?.UTF8 ?? 'utf8',
    });
    // expo-file-system has no atomic rename; moveAsync(over an existing
    // file) is the closest equivalent. Some Expo versions expose
    // `deleteAsync({idempotent: true})` to clear the target first; we
    // try moveAsync directly and fall back to delete-then-move.
    try {
      await this.#FileSystem.moveAsync({ from: tmp, to: this.#path });
    } catch {
      try { await this.#FileSystem.deleteAsync(this.#path, { idempotent: true }); } catch { /* swallow */ }
      await this.#FileSystem.moveAsync({ from: tmp, to: this.#path });
    }
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
      this.save(map).catch(() => { /* upstream onError handles */ });
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

/**
 * Lightweight dirname for `file://` URIs (no Node.js `path` dep on RN).
 * Strips the trailing `/<filename>` and returns the parent (or null
 * if there's no slash to strip).
 */
function _dirname(p) {
  const i = p.lastIndexOf('/');
  if (i <= 0) return null;
  return p.slice(0, i);
}
