/**
 * VaultEncrypted — at-rest encryption as a decorator over ANY Vault backend.
 *
 * Wraps an existing vault (LocalStorage, AsyncStorage, IndexedDB, NodeFs, Memory) and
 * encrypts every value with XSalsa20-Poly1305 (tweetnacl secretbox) under a caller-supplied
 * 32-byte key. The key is derived from the owner's recovery phrase by the caller
 * (`Bootstrap.deriveVaultAtRestKey()` in @onderling/core) — this package never sees the
 * phrase and holds no derivation logic, so the decorator composes with any backend on any
 * platform (secretbox is pure JS: Node, browser, React Native alike).
 *
 * Storage format per value: `enc1:<b64u nonce>:<b64u ciphertext>` — self-describing, so a
 * reader can tell an encrypted value from a plaintext one without trial decryption.
 *
 * Reading is STRICT: a value that does not carry the `enc1:` prefix throws instead of being
 * passed through. A plaintext value behind this decorator means the one-time migration
 * (`migrateVaultToEncrypted`) has not run for this store, and silently returning plaintext
 * would hide exactly the condition the migration's sentinel exists to make unambiguous.
 * A failed decryption (wrong key) also throws, loudly: the caller supplied the wrong unlock
 * secret and must be told so, not handed a null that reads as "no such entry".
 */
import nacl from 'tweetnacl';
import { Vault } from './Vault.js';

const PREFIX = 'enc1:';

/**
 * The reserved backing-store key that marks a store as fully migrated to at-rest
 * encryption. Stored as a PLAIN value (it gates decryption, so it cannot itself be
 * encrypted) and hidden from `list()`.
 */
export const VAULT_ENC_SENTINEL_KEY = '__vault-enc__';
/** The sentinel value written by the current migration. */
export const VAULT_ENC_VERSION = 'v1';

function b64u(u8) {
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/'));
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const te = new TextEncoder();
const td = new TextDecoder();

export class VaultEncrypted extends Vault {
  #backing;
  #key;

  /**
   * @param {object} o
   * @param {Vault}      o.backing  the persistent vault being decorated.
   * @param {Uint8Array} o.key      32-byte symmetric key (secretbox key length).
   */
  constructor({ backing, key } = {}) {
    super();
    if (!backing || typeof backing.get !== 'function') {
      throw new Error('VaultEncrypted: a backing vault is required');
    }
    if (!(key instanceof Uint8Array) || key.length !== nacl.secretbox.keyLength) {
      throw new Error(`VaultEncrypted: key must be a ${nacl.secretbox.keyLength}-byte Uint8Array`);
    }
    this.#backing = backing;
    this.#key = key;
  }

  /** Whether a stored value carries the encrypted format. */
  static isEncryptedValue(v) {
    return typeof v === 'string' && v.startsWith(PREFIX);
  }

  #seal(value) {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const box = nacl.secretbox(te.encode(String(value)), nonce, this.#key);
    return `${PREFIX}${b64u(nonce)}:${b64u(box)}`;
  }

  #open(stored, key) {
    const parts = stored.slice(PREFIX.length).split(':');
    if (parts.length !== 2) throw new Error(`VaultEncrypted: malformed entry "${key}"`);
    const plain = nacl.secretbox.open(unb64u(parts[1]), unb64u(parts[0]), this.#key);
    if (!plain) {
      throw new Error(`VaultEncrypted: decryption failed for "${key}" — wrong unlock secret, or the entry was corrupted`);
    }
    return td.decode(plain);
  }

  async get(key) {
    const stored = await this.#backing.get(key);
    if (stored == null) return null;
    if (!VaultEncrypted.isEncryptedValue(stored)) {
      throw new Error(
        `VaultEncrypted: plaintext value at "${key}" — this store has not been migrated `
        + '(run migrateVaultToEncrypted before reading through the encrypted vault)',
      );
    }
    return this.#open(stored, key);
  }

  async set(key, value) {
    await this.#backing.set(key, this.#seal(value));
  }

  async delete(key) { await this.#backing.delete(key); }
  async has(key)    { return this.#backing.has(key); }

  async list() {
    const keys = await this.#backing.list();
    return keys.filter((k) => k !== VAULT_ENC_SENTINEL_KEY);
  }
}

/**
 * One-time, idempotent, crash-resumable migration of a plaintext vault to at-rest
 * encryption.
 *
 * The SENTINEL — not per-value trial decryption — decides which path a boot takes: absent
 * means "plaintext store, migrate on this unlock"; present means "everything is encrypted,
 * read through VaultEncrypted". So a store is never read ambiguously half-and-half.
 *
 * Order of operations (deliberate):
 *   1. every entry is re-written encrypted (already-encrypted entries are skipped, which is
 *      what makes a crash mid-migration resumable — rerun and it completes);
 *   2. the sentinel is written — only when every entry is sealed;
 *   3. the `drop` keys are deleted LAST (the owner-phrase: after this, the phrase exists
 *      only in the user's hands). A crash before step 3 loses nothing.
 *
 * With a `fingerprint` (a stable, non-secret identifier of the ROOT the key derives from —
 * `Bootstrap.fingerprint()`), the sentinel binds the vault to that root: `v1:<fingerprint>`.
 * A boot under a DIFFERENT root (the user restored another phrase — a deliberate identity
 * switch) then finds a mismatched sentinel and RESETS the vault: every entry is deleted and
 * the vault starts clean under the new root. That is the designed semantic, not data loss —
 * entries sealed to the old root are undecryptable garbage to the new one, and the previous
 * person's device secrets (identity seeds, capability tokens, mute lists) must not carry
 * over to the restored person. Without a fingerprint the sentinel is bare `v1` (no binding).
 *
 * @param {object} o
 * @param {Vault}      o.backing      the plaintext vault to migrate in place.
 * @param {Uint8Array} o.key          32-byte at-rest key (see VaultEncrypted).
 * @param {string[]}  [o.drop]        keys to REMOVE rather than encrypt (secrets that must not
 *                                    persist at all, e.g. the recovery phrase the key derives from —
 *                                    keeping an encrypted copy of that would be circular).
 * @param {string}    [o.fingerprint] root identifier to bind the sentinel to (see above).
 * @returns {Promise<{migrated: boolean, sealed: number, dropped: number, reset?: true}>}
 *          `migrated: false` when the sentinel already matched (nothing touched);
 *          `reset: true` when a root switch wiped the vault.
 */
export async function migrateVaultToEncrypted({ backing, key, drop = [], fingerprint } = {}) {
  const expected = fingerprint ? `${VAULT_ENC_VERSION}:${fingerprint}` : VAULT_ENC_VERSION;
  const existing = await backing.get(VAULT_ENC_SENTINEL_KEY);
  if (existing === expected) return { migrated: false, sealed: 0, dropped: 0 };

  // A sentinel from a DIFFERENT root: identity switch — start clean (see the JSDoc above).
  let reset = false;
  if (existing != null) {
    for (const k of await backing.list()) await backing.delete(k);
    await backing.delete(VAULT_ENC_SENTINEL_KEY);
    reset = true;
  }

  const enc = new VaultEncrypted({ backing, key });
  const dropSet = new Set(drop);
  let sealed = 0;

  for (const k of await backing.list()) {
    if (k === VAULT_ENC_SENTINEL_KEY || dropSet.has(k)) continue;
    const raw = await backing.get(k);
    if (raw == null || VaultEncrypted.isEncryptedValue(raw)) continue;
    await enc.set(k, raw);
    sealed += 1;
  }

  await backing.set(VAULT_ENC_SENTINEL_KEY, expected);

  let dropped = 0;
  for (const k of dropSet) {
    if (await backing.has(k)) {
      await backing.delete(k);
      dropped += 1;
    }
  }
  return reset ? { migrated: true, sealed, dropped, reset: true } : { migrated: true, sealed, dropped };
}

/**
 * RESEAL a fully-encrypted vault from one at-rest key to another, in place (the custody
 * migration: the sealing root moves from the owner root to the device's delegation seed; the
 * sentinel — bound to the ROOT's fingerprint, the same person — stays as it is).
 *
 * Crash-resumable per entry: an entry that already opens under the NEW key is skipped, so a
 * rerun after a mid-reseal crash completes the job. An entry that opens under NEITHER key is a
 * genuine fault and throws — silently dropping it would be data loss wearing a success face.
 *
 * @param {object} o
 * @param {Vault}      o.backing  the encrypted vault (sentinel present).
 * @param {Uint8Array} o.oldKey
 * @param {Uint8Array} o.newKey
 * @returns {Promise<{resealed: number, skipped: number}>}
 */
export async function resealVault({ backing, oldKey, newKey } = {}) {
  const oldEnc = new VaultEncrypted({ backing, key: oldKey });
  const newEnc = new VaultEncrypted({ backing, key: newKey });
  let resealed = 0; let skipped = 0;
  for (const k of await backing.list()) {
    if (k === VAULT_ENC_SENTINEL_KEY) continue;
    const raw = await backing.get(k);
    if (raw == null || !VaultEncrypted.isEncryptedValue(raw)) continue;   // plaintext strays: the migrate pass's job
    let plain;
    try { plain = await oldEnc.get(k); }
    catch {
      try { await newEnc.get(k); skipped += 1; continue; }   // already resealed (crash resume)
      catch { throw new Error(`resealVault: entry "${k}" opens under neither key — refusing to continue`); }
    }
    await newEnc.set(k, plain);
    resealed += 1;
  }
  return { resealed, skipped };
}
