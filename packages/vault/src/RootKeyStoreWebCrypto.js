/**
 * RootKeyStoreWebCrypto — the browser's key door for the device's seed.
 *
 * WITHOUT A LOCK (`open`): the seed sits in IndexedDB only AES-GCM-encrypted under a NON-EXTRACTABLE WebCrypto key
 * stored beside it (`wrap-key`). Its bytes cannot be read by script. That is all it holds: the browser writes the key
 * into the profile on disk, and any script on this origin can USE it, so someone who copies the browser's files, or a
 * script on the origin, opens the seed.
 *
 * WITH A LOCK (`locked` · `unlocked`): the person's secret wraps the key. A random 32-byte DOOR KEY seals the seed
 * (`door-sealed-seed`); the door key is stored only wrapped, once per secret, in `slots` (one slot of the passphrase
 * kind for now: the key from the secret by the slow derivation the caller passes as `kdf`). Opening derives the slot's
 * key, unwraps the door key and keeps it in this page's memory only. While locked there is no key to use, also not from
 * the developer tools or a copied profile; `getSeed` throws `KeyLocked`.
 *
 * Switching the lock on or off moves the seed between the two shapes once, each step proven before the next; the old
 * shape's entries go last, in one transaction, and while they exist the door counts as `open`. A failure or a closed
 * tab before that point leaves the old door working.
 *
 * Clearing site data destroys every entry, after which the recovery phrase is, by design, the only way back in, also
 * for a forgotten secret (start over, then the phrase).
 *
 * Browser-only (needs IndexedDB + crypto.subtle); construction throws elsewhere — callers pick a fallback via their
 * platform picker, like the vault family does.
 */
import { RootKeyStore, assertSeed, KeyLocked, ROOT_SEED_LEN } from './RootKeyStore.js';

const DB_NAME     = 'onderling-root-key';
const STORE       = 'keys';
const K_WRAP      = 'wrap-key';
const K_SEED      = 'sealed-seed';
const K_DOOR_SEED = 'door-sealed-seed';
const K_SLOTS     = 'slots';
const SALT_LEN    = 16;

/**
 * The passphrase slot's Argon2id cost (m in KiB), written INTO each slot so it can be raised later. It runs at every
 * open of the app, so it is lower than the backup's 64 MiB / t 3. Measured 2026-11-26 in headless Chromium on the
 * builder's laptop, one derivation: 64 MiB t 3 = 2.08 s, 64 MiB t 2 = 1.39 s, 46 MiB t 2 = 0.99 s, 32 MiB t 3 = 1.02 s.
 * Chosen: 46 MiB, t 2 (about a second, with room for a slower laptop). Never the vault's PBKDF2.
 */
export const PASSPHRASE_SLOT_PARAMS = Object.freeze({ m: 46 * 1024, t: 2, p: 1 });

/** The code a `SecretEmpty` carries. */
export const SECRET_EMPTY = 'secret-empty';

/** A lock was asked for with no secret at all: a short code is allowed, nothing is not a code. */
export class SecretEmpty extends Error {
  constructor() {
    super('A lock needs a code or a passphrase; an empty one is not');
    this.name = 'SecretEmpty';
    this.code = SECRET_EMPTY;
  }
}

/**
 * The secret as it is derived, in ONE place for setting and opening alike: text in Unicode NFC, so the same passphrase
 * typed with a composed or a decomposed accent (one keyboard or another) opens the same door.
 */
const secretOf = (secret) => String(secret ?? '').normalize('NFC');

const aesKey = (raw, usages) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
const seal = async (key, bytes) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv, blob: await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes) }; };
const open = async (key, sealed) => new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.blob));
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** The browser's root-key store (see the file header). */
export class RootKeyStoreWebCrypto extends RootKeyStore {
  #db = null;
  #dbName;
  #kdf;
  /** the door key, in this page's memory only, while the door is unlocked */
  #doorKey = null;

  /**
   * @param {object} [o]
   * @param {string} [o.dbName]  the IndexedDB database (a test opens a copy under another name)
   * @param {{name: string, params?: object, derive: (secret: string, salt: Uint8Array, params: object) => Uint8Array}} [o.kdf]
   *   the slow derivation for a passphrase slot (the app passes core's `derivePassphraseKey`, name 'argon2id'); its
   *   parameters default to PASSPHRASE_SLOT_PARAMS (a test passes cheap ones). A lock cannot be set or opened without it
   */
  constructor({ dbName = DB_NAME, kdf = null } = {}) {
    super();
    if (typeof indexedDB === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('RootKeyStoreWebCrypto requires IndexedDB + WebCrypto (browser only)');
    }
    this.#dbName = dbName;
    this.#kdf = kdf;
  }

  async #open() {
    if (this.#db) return;
    this.#db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.#dbName, 1);
      req.onupgradeneeded = (e) => { e.target.result.createObjectStore(STORE); };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
    // Close when a delete (or upgrade) of this database asks: holding on would BLOCK it — a start-over from the phrase
    // deletes the key door in the same tab that read it (basis startOver.js). The next call opens it again.
    this.#db.onversionchange = () => { try { this.#db?.close(); } catch { /* already closed */ } this.#db = null; };
  }

  #tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  /** Several writes and deletes in ONE transaction: all land or none does. @param {Array<[string, unknown]>} puts @param {string[]} deletes */
  async #commit(puts, deletes = []) {
    await this.#open();
    await new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      for (const [k, v] of puts) s.put(v, k);
      for (const k of deletes) s.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('RootKeyStoreWebCrypto: the write was aborted'));
    });
  }

  async #get(k) { await this.#open(); return this.#tx('readonly', (s) => s.get(k)); }

  /** Which shape holds the seed now: the old one wins while its entries exist (a switch not yet committed). */
  async #shape() {
    const [wrap, seed, slots, doorSeed] = [await this.#get(K_WRAP), await this.#get(K_SEED), await this.#get(K_SLOTS), await this.#get(K_DOOR_SEED)];
    if (seed) return { kind: 'open', wrap, seed };
    if (Array.isArray(slots) && slots.length && doorSeed) return { kind: 'lock', slots, doorSeed };
    return { kind: 'empty' };
  }

  #derive() {
    if (!this.#kdf || typeof this.#kdf.derive !== 'function') throw new Error('RootKeyStoreWebCrypto: a lock needs the `kdf` option (the slow derivation for a secret)');
    return { ...this.#kdf, params: this.#kdf.params ?? PASSPHRASE_SLOT_PARAMS };
  }

  /** The door key's bytes wrapped under a key from `secret`: one passphrase slot, with what derives its key again. */
  async #makeSlot(secret, doorKeyBytes) {
    const kdf = this.#derive();
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const slotKey = await aesKey(kdf.derive(secretOf(secret), salt, kdf.params), ['encrypt']);
    const { iv, blob } = await seal(slotKey, doorKeyBytes);
    return { kind: 'passphrase', kdf: { name: kdf.name, salt, params: { ...kdf.params } }, iv, wrapped: blob };
  }

  /** The door key from a slot and a secret, or null when the secret is not the one (the unwrap fails). */
  async #openSlot(slot, secret) {
    const derive = this.#derive().derive;
    const slotKey = await aesKey(derive(secretOf(secret), slot.kdf.salt, slot.kdf.params), ['decrypt']);
    let bytes;
    try { bytes = await open(slotKey, { iv: slot.iv, blob: slot.wrapped }); } catch { return null; }
    if (bytes.length !== ROOT_SEED_LEN) return null;
    return aesKey(bytes, ['encrypt', 'decrypt']);
  }

  async status() {
    const shape = await this.#shape();
    if (shape.kind === 'lock') return this.#doorKey ? 'unlocked' : 'locked';
    return shape.kind;
  }

  async getSeed() {
    const shape = await this.#shape();
    if (shape.kind === 'empty') return null;
    let seed;
    if (shape.kind === 'lock') {
      if (!this.#doorKey) throw new KeyLocked();
      seed = await open(this.#doorKey, shape.doorSeed);
    } else {
      if (!shape.wrap) throw new Error('RootKeyStoreWebCrypto: a sealed seed exists but its wrap key is gone — restore from the recovery phrase');
      seed = await open(shape.wrap, shape.seed);
    }
    assertSeed(seed, 'RootKeyStoreWebCrypto.getSeed');
    return seed;
  }

  async setSeed(seed) {
    assertSeed(seed, 'RootKeyStoreWebCrypto.setSeed');
    const shape = await this.#shape();
    if (shape.kind === 'lock') {
      // a ceremony's cutover on an open lock: sealed under the door key in memory, no secret asked again
      if (!this.#doorKey) throw new KeyLocked();
      await this.#commit([[K_DOOR_SEED, await seal(this.#doorKey, seed)]]);
      return;
    }
    let key = shape.kind === 'open' ? shape.wrap : await this.#get(K_WRAP);
    const puts = [];
    if (!key) { key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']); puts.push([K_WRAP, key]); }
    puts.push([K_SEED, await seal(key, seed)]);
    await this.#commit(puts);
  }

  async deleteSeed() {
    this.#doorKey = null;
    await this.#commit([], [K_SEED, K_DOOR_SEED, K_SLOTS]);
  }

  /** Open a locked door with the secret: true, or false for a wrong secret (nothing else is tried; it never throws for that). */
  async unlock(secret) {
    const shape = await this.#shape();
    if (shape.kind !== 'lock') return false;
    const key = await this.#openSlot(shape.slots[0], secret);
    if (!key) return false;
    this.#doorKey = key;
    return true;
  }

  /** Close the door: the door key leaves this page's memory. */
  lock() { this.#doorKey = null; }

  /**
   * Set the lock on an `open` door. It re-keys the door once: read the seed with the old key, seal it under a new door
   * key with its slot, read it back THROUGH the slot, and only then delete the old key and copy (one transaction). A
   * failure before that last step leaves the old door working, removes what was half written, and throws. A door that
   * already has a lock refuses: a new secret means switching the lock off and on again (the door key cannot be read
   * out to wrap it a second time).
   */
  async setLock(secret) {
    const shape = await this.#shape();
    if (shape.kind === 'empty') throw new Error('RootKeyStoreWebCrypto.setLock: there is no seed to lock');
    if (shape.kind === 'lock') throw new Error('RootKeyStoreWebCrypto.setLock: the door has a lock already; switch it off first');
    if (secretOf(secret) === '') throw new SecretEmpty();
    const seed = await this.getSeed();
    const doorKeyBytes = crypto.getRandomValues(new Uint8Array(ROOT_SEED_LEN));
    const doorKey = await aesKey(doorKeyBytes, ['encrypt', 'decrypt']);
    let back = null;
    try {
      const slot = await this.#makeSlot(secret, doorKeyBytes);
      await this.#commit([[K_SLOTS, [slot]], [K_DOOR_SEED, await seal(doorKey, seed)]]);
      back = await this.#openSlot((await this.#get(K_SLOTS))?.[0], secret);
      if (!back || !same(await open(back, await this.#get(K_DOOR_SEED)), seed)) throw new Error('the lock read back differently');
    } catch (e) {
      // the old shape still wins (its entries are there); the half-written lock goes so nothing stale stays beside it
      await this.#commit([], [K_SLOTS, K_DOOR_SEED]).catch(() => {});
      throw new Error(`RootKeyStoreWebCrypto.setLock: the lock could not be set; the door is unchanged (${e?.message ?? e})`);
    } finally {
      doorKeyBytes.fill(0);
    }
    await this.#commit([], [K_WRAP, K_SEED]);
    this.#doorKey = back;
  }

  /** Switch the lock off on an `unlocked` door: back to the shape without a lock (a fresh non-extractable key), the seed unchanged. */
  async clearLock() {
    const shape = await this.#shape();
    if (shape.kind !== 'lock') return;
    if (!this.#doorKey) throw new KeyLocked();
    const seed = await this.getSeed();
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    // the old shape's entries win from this write on; then the lock's entries go
    await this.#commit([[K_WRAP, key], [K_SEED, await seal(key, seed)]]);
    const back = await open(await this.#get(K_WRAP), await this.#get(K_SEED)).catch(() => null);
    if (!back || !same(back, seed)) {
      // the lock's entries are still there: removing the half-written old shape gives the lock back
      await this.#commit([], [K_WRAP, K_SEED]).catch(() => {});
      throw new Error('RootKeyStoreWebCrypto.clearLock: the seed could not be read back; the lock is unchanged');
    }
    await this.#commit([], [K_SLOTS, K_DOOR_SEED]);
    this.#doorKey = null;
  }
}
