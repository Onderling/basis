/**
 * RootKeyStoreWebCrypto — the browser's key door for the owner-root seed.
 *
 * The seed sits in IndexedDB only AES-GCM-encrypted under a NON-EXTRACTABLE WebCrypto
 * key stored beside it. A non-extractable CryptoKey can be *used* by this origin but its
 * raw bytes can never be read out — so someone who copies the browser profile / disk
 * backup gets a ciphertext and a handle that does not travel, not the seed.
 *
 * Honest limits, stated: code running in this same origin can still USE the wrap key to
 * decrypt (this is at-rest protection against disk/backup readout, not against an XSS'd
 * origin), and clearing site data destroys both entries — after which the recovery phrase
 * is, by design, the only way back in. That last property is the product promise, not a
 * defect: the phrase is the key the user holds.
 *
 * Browser-only (needs IndexedDB + crypto.subtle); construction throws elsewhere —
 * callers pick a fallback via their platform picker, like the vault family does.
 */
import { RootKeyStore, assertSeed } from './RootKeyStore.js';

const DB_NAME    = 'onderling-root-key';
const STORE      = 'keys';
const K_WRAP     = 'wrap-key';
const K_SEED     = 'sealed-seed';

export class RootKeyStoreWebCrypto extends RootKeyStore {
  #db = null;

  constructor() {
    super();
    if (typeof indexedDB === 'undefined' || typeof crypto === 'undefined' || !crypto.subtle) {
      throw new Error('RootKeyStoreWebCrypto requires IndexedDB + WebCrypto (browser only)');
    }
  }

  async #open() {
    if (this.#db) return;
    this.#db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (e) => { e.target.result.createObjectStore(STORE); };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror   = (e) => reject(e.target.error);
    });
  }

  #tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.#db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async #wrapKey() {
    let key = await this.#tx('readonly', (s) => s.get(K_WRAP));
    if (!key) {
      key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        /* extractable */ false,
        ['encrypt', 'decrypt'],
      );
      await this.#tx('readwrite', (s) => s.put(key, K_WRAP));
    }
    return key;
  }

  async getSeed() {
    await this.#open();
    const sealed = await this.#tx('readonly', (s) => s.get(K_SEED));
    if (!sealed) return null;
    const key = await this.#tx('readonly', (s) => s.get(K_WRAP));
    if (!key) throw new Error('RootKeyStoreWebCrypto: a sealed seed exists but its wrap key is gone — restore from the recovery phrase');
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.iv }, key, sealed.blob);
    const seed = new Uint8Array(plain);
    assertSeed(seed, 'RootKeyStoreWebCrypto.getSeed');
    return seed;
  }

  async setSeed(seed) {
    assertSeed(seed, 'RootKeyStoreWebCrypto.setSeed');
    await this.#open();
    const key = await this.#wrapKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const blob = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, seed);
    await this.#tx('readwrite', (s) => s.put({ iv, blob }, K_SEED));
  }

  async deleteSeed() {
    await this.#open();
    await this.#tx('readwrite', (s) => s.delete(K_SEED));
  }
}
