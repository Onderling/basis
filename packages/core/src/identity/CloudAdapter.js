/**
 * CloudAdapter — interface for cloud storage backends used by `CloudBackup`.
 *
 * @abstract
 *
 * Concrete adapters are deferred per Q-C.5 (e.g. Dropbox, Google Drive,
 * iCloud, S3) and live in `packages/react-native/` (platform-native) or in
 * a follow-up Track-C task (C2).  This file ships only the interface and a
 * minimal in-memory implementation (`MemoryAdapter`) for tests.
 *
 * Apps supply a concrete instance to `CloudBackup` via `new CloudBackup({
 * adapter, ... })`.
 *
 * Spec refs:
 *   - `coding-plans/track-C-recovery-backup.md` §C1.
 *   - Track-C launch prompt §Q-C.5 (adapter selection parked).
 */

/**
 * Abstract cloud-storage interface.
 *
 * Implementations MUST persist `bytes` keyed by `ref` and return the same
 * bytes from `get(ref)`.  `delete(ref)` removes the blob; `list()` returns
 * the set of refs currently stored.
 */
export class CloudAdapter {
  /**
   * Upload a blob with a deterministic identifier.
   *
   * @param   {string}     ref   caller-chosen stable id, e.g. `'onderling-bootstrap.enc'`
   * @param   {Uint8Array} bytes blob payload
   * @param   {object}     [opts]
   * @returns {Promise<{ ref: string, version?: string }>}
   */
  // eslint-disable-next-line no-unused-vars
  async put(ref, bytes, opts) {
    throw new Error('CloudAdapter.put() not implemented');
  }

  /**
   * Download a blob.
   *
   * @param   {string} ref
   * @returns {Promise<Uint8Array | null>}  null if not found
   */
  // eslint-disable-next-line no-unused-vars
  async get(ref) {
    throw new Error('CloudAdapter.get() not implemented');
  }

  /**
   * Delete a blob.  Implementations SHOULD treat "not found" as success.
   *
   * @param   {string} ref
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async delete(ref) {
    throw new Error('CloudAdapter.delete() not implemented');
  }

  /**
   * List all refs currently stored by this adapter.
   *
   * @returns {Promise<string[]>}
   */
  async list() {
    throw new Error('CloudAdapter.list() not implemented');
  }
}

/**
 * MemoryAdapter — in-memory `CloudAdapter` for tests and local development.
 *
 * Not for production: no persistence, no concurrency control, no quota.
 * Useful as a stand-in while concrete adapters are deferred and as
 * the substrate for `CloudBackup.test.js`.
 */
export class MemoryAdapter extends CloudAdapter {
  /** @type {Map<string, Uint8Array>} */
  #blobs = new Map();

  async put(ref, bytes /* , opts */) {
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new Error('MemoryAdapter.put: ref must be a non-empty string');
    }
    if (!(bytes instanceof Uint8Array)) {
      throw new Error('MemoryAdapter.put: bytes must be a Uint8Array');
    }
    // Defensive copy so callers cannot mutate stored state.
    this.#blobs.set(ref, new Uint8Array(bytes));
    return { ref };
  }

  async get(ref) {
    const stored = this.#blobs.get(ref);
    if (!stored) return null;
    // Defensive copy on read for the same reason.
    return new Uint8Array(stored);
  }

  async delete(ref) {
    this.#blobs.delete(ref);
  }

  async list() {
    return [...this.#blobs.keys()];
  }
}
