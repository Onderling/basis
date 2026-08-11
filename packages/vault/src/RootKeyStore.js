/**
 * RootKeyStore — where a device keeps the owner-root SEED between launches.
 *
 * The recovery phrase itself is never persisted (it lives in the user's hands); what a
 * device may hold is the 32-byte seed the phrase encodes, in the most protected place the
 * platform offers. This contract is that place, behind one interface:
 *
 *   • mobile   — the OS keystore (expo-secure-store → Android Keystore / iOS Keychain),
 *                gated by the device unlock. Adapter lives with the app shell, which owns
 *                the native dependency.
 *   • web      — `RootKeyStoreWebCrypto`: the seed at rest only AES-GCM-wrapped under a
 *                NON-EXTRACTABLE WebCrypto key in IndexedDB.
 *   • Node /
 *     fallback — `RootKeyStoreVault`: the seed in a plain Vault. No stronger door exists
 *                on these hosts; the honest gain over the old phrase-at-rest is containment
 *                (see below), not secrecy.
 *
 * Why store the SEED and not the phrase, when they encode the same secret: uniformity of
 * treatment. The phrase is the human artifact ("24 woorden = je sleutel") and the promise
 * is that it exists only on paper/in memory; the seed is the machine artifact and goes in
 * the machine's key place. `Bootstrap.toMnemonic()` re-renders the phrase from the seed
 * when the user asks to see it — one secret, two encodings, each kept where it belongs.
 */

export class RootKeyStore {
  /** @returns {Promise<Uint8Array|null>} the 32-byte seed, or null when this device holds none. */
  async getSeed()      { throw new Error(`${this.constructor.name}.getSeed() not implemented`); }
  /** @param {Uint8Array} seed 32 bytes. */
  async setSeed(seed)  { throw new Error(`${this.constructor.name}.setSeed() not implemented`); }
  async deleteSeed()   { throw new Error(`${this.constructor.name}.deleteSeed() not implemented`); }
}

export const ROOT_SEED_LEN = 32;

export function assertSeed(seed, who) {
  if (!(seed instanceof Uint8Array) || seed.length !== ROOT_SEED_LEN) {
    throw new Error(`${who}: seed must be a ${ROOT_SEED_LEN}-byte Uint8Array`);
  }
}

// b64url helpers (btoa/atob exist in Node 16+, browsers, and the Expo runtime).
export function seedToString(seed) {
  let bin = '';
  for (let i = 0; i < seed.length; i++) bin += String.fromCharCode(seed[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function seedFromString(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

/** In-memory store — tests and ephemeral agents. */
export class RootKeyStoreMemory extends RootKeyStore {
  #seed = null;
  async getSeed()     { return this.#seed ? new Uint8Array(this.#seed) : null; }
  async setSeed(seed) { assertSeed(seed, 'RootKeyStoreMemory.setSeed'); this.#seed = new Uint8Array(seed); }
  async deleteSeed()  { this.#seed = null; }
}

/** The Vault-backed key the seed is stored under. */
export const ROOT_SEED_VAULT_KEY = 'owner-root-seed';

/**
 * Fallback store over any Vault, for hosts without a platform key door (Node processes,
 * a browser without IndexedDB/WebCrypto, tests over VaultMemory). At-rest protection is
 * whatever the backing vault provides — the gain over the retired phrase-at-rest is that
 * what sits on disk is one device's seed encoding, no longer the user-facing recovery
 * artifact the product promises exists only in their hands.
 */
export class RootKeyStoreVault extends RootKeyStore {
  #vault;
  constructor({ vault } = {}) {
    super();
    if (!vault || typeof vault.get !== 'function') throw new Error('RootKeyStoreVault: a backing vault is required');
    this.#vault = vault;
  }
  async getSeed() {
    const s = await this.#vault.get(ROOT_SEED_VAULT_KEY);
    if (s == null || s === '') return null;
    const seed = seedFromString(s);
    assertSeed(seed, 'RootKeyStoreVault.getSeed');
    return seed;
  }
  async setSeed(seed) {
    assertSeed(seed, 'RootKeyStoreVault.setSeed');
    await this.#vault.set(ROOT_SEED_VAULT_KEY, seedToString(seed));
  }
  async deleteSeed() { await this.#vault.delete(ROOT_SEED_VAULT_KEY); }
}
