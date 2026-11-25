/**
 * TombstoneStore — per-device per-URI tombstone tracking.
 *
 * @abstract
 *
 * Tombstones exist so that `PodClient.list()` can hide URIs the user has
 * marked deleted-locally, and so any app-level sync routine knows to skip
 * them.  The SDK itself does not auto-sync; tombstones are a primitive for
 * apps that build their own sync OR for the list-filter convenience.
 *
 * Key-value shape: uri → { at: number }   (unix-ms timestamp).
 *
 * Implementations: MemoryTombstones (tests), IndexedDBTombstones (web),
 * AsyncStorageTombstones (RN).
 */
export class TombstoneStore {
  /**
   * Record a tombstone for `uri`.  Idempotent: re-adding refreshes timestamp.
   * @param {string} uri
   * @param {{ at?: number }} [opts]
   * @returns {Promise<void>}
   */
  async add(uri, opts) {                  // eslint-disable-line no-unused-vars
    throw new Error('TombstoneStore.add() not implemented');
  }

  /**
   * @param {string} uri
   * @returns {Promise<boolean>}
   */
  async has(uri) {                        // eslint-disable-line no-unused-vars
    throw new Error('TombstoneStore.has() not implemented');
  }

  /**
   * Remove a tombstone for `uri`.  Idempotent: removing an absent entry is a no-op.
   * @param {string} uri
   * @returns {Promise<void>}
   */
  async remove(uri) {                     // eslint-disable-line no-unused-vars
    throw new Error('TombstoneStore.remove() not implemented');
  }

  /**
   * @returns {Promise<Array<{ uri: string, at: number }>>}
   */
  async list() {
    throw new Error('TombstoneStore.list() not implemented');
  }

  /** Idempotent close — release any resources. */
  async close() { /* idempotent */ }
}
