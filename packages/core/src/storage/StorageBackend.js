/**
 * ┌─ PORT ──────────────────────────────────────────────────────────────────────┐
 * │ `StorageBackend` is the interface a BLIND ciphertext store implements. It is  │
 * │ deliberately narrower than `DataSource`: three methods, ciphertext ONLY.      │
 * │ Reference adapter: `MemoryStorageBackend` (this package). Pod adapter:         │
 * │ `podStorageBackend` (@onderling/pod-client). Prove conformance with           │
 * │ `assertStorageBackendConformance()` (conformance/storageBackendConformance.js).│
 * └──────────────────────────────────────────────────────────────────────────────┘
 *
 * StorageBackend — abstract base for a store that holds ONLY ciphertext.
 *
 * The whole point of this port is that the STORE is a free choice, because the
 * SEAL — not the store's access control — is what gates who can read content.
 * A caller seals a datum ABOVE this port (via the seal resolver:
 * `sealForAudience` in @onderling/pod-client) and hands the resulting ciphertext
 * down through `put`; the backend moves opaque bytes it can never open. Because
 * access is gated by the seal and not by the backend, the same sealed content is
 * portable across backends: put it in a local in-memory store, an IndexedDB
 * mirror, or a Solid pod and it still opens for a key-holder and stays closed to
 * everyone else. A pod's ACP/WAC then becomes defence-in-depth on top of the
 * seal, not the mechanism.
 *
 * Contrast with `DataSource` (read/write/delete/list, plaintext-capable, the
 * general storage adapter apps persist state through): `StorageBackend` is the
 * SEALED-CONTENT transport surface. It exposes no `read` that decodes, no
 * `write` that a caller might hand plaintext to by convention, and no `query`
 * over cleartext fields — only opaque put/get/list. Keeping it separate makes
 * "the backend never sees plaintext" a property of the TYPE, not of discipline.
 *
 * ── The port contract (what an adapter must uphold) ────────────────────────────
 *   • `put(ref, ciphertext)`  → store the opaque ciphertext under `ref`
 *                               (create-or-overwrite); resolves when durable.
 *   • `get(ref)`              → the stored ciphertext, or `null` when `ref` is absent.
 *   • `list(prefix='')`       → every stored `ref` that starts with `prefix`.
 * `ref` is an opaque forward-slash key; `ciphertext` is an opaque string (a
 * sealed envelope). Every method is async (returns a Promise).
 */
export class StorageBackend {
  /**
   * Store opaque ciphertext under a ref (creates or overwrites).
   * @param {string} ref
   * @param {string} ciphertext  a sealed envelope — the backend never opens it.
   * @returns {Promise<void>}
   */
  async put(ref, ciphertext) { throw new Error(`${this.constructor.name}.put() not implemented`); }   // eslint-disable-line no-unused-vars

  /**
   * Fetch the ciphertext stored under a ref.
   * @param {string} ref
   * @returns {Promise<string|null>} the stored ciphertext, or null when absent.
   */
  async get(ref) { throw new Error(`${this.constructor.name}.get() not implemented`); }   // eslint-disable-line no-unused-vars

  /**
   * List every stored ref that starts with prefix.
   * @param {string} [prefix='']
   * @returns {Promise<string[]>}
   */
  async list(prefix = '') { throw new Error(`${this.constructor.name}.list() not implemented`); }   // eslint-disable-line no-unused-vars
}
