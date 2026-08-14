/**
 * Bootstrap — root identity secret for Track B (identity-as-pod-content sync).
 *
 * A `Bootstrap` carries the 32-byte root secret from which:
 *   • the BIP-39 24-word recovery phrase is derived (via Mnemonic.js)
 *   • per-resource symmetric encryption keys are derived (via HKDF-SHA256
 *     per `Design-v3/identity-pod-schema.md` §Encryption protocol)
 *   • a stable bootstrap-pubkey is derived (Ed25519 from the seed) used
 *     for the `dw:bootstrapKeyFingerprint` predicate in device records.
 *
 * Bootstrap composes (does not replace) the existing identity primitives:
 *   - `Mnemonic.{generate,validate,seedTo,mnemonicToSeed}`
 *   - `AgentIdentity` (constructed with `vault: null` when we just need
 *     the derived Ed25519 keypair, without persisting).
 *   - `KeyRotation` (callers wire `Bootstrap.onKeyRotated(cb)` and invoke
 *     it from their rotate flow — KeyRotation is a static utility, not
 *     an event emitter; see B1.6 / TODO below).
 *
 * Spec refs:
 *   - HKDF derivation: identity-pod-schema.md §Encryption protocol →
 *     §Key derivation.
 *   - Fingerprint: identity-pod-schema.md §Container layout — first 16
 *     hex chars of SHA-256 over the ed25519 pubkey.
 *   - Predicate: `dw:bootstrapKeyFingerprint` in §Vocabulary.
 */
import nacl from 'tweetnacl';
// `node:crypto` is shimmed on React Native — use the pure-JS HKDF
// from `@noble/hashes` (already a core dep).
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { Emitter } from '../Emitter.js';
import {
  generateMnemonic,
  mnemonicToSeed,
  seedToMnemonic,
  validateMnemonic,
} from './Mnemonic.js';

const SEED_LEN     = 32;
// HKDF domain-separation input (hashed, invisible). Clean break pre-launch — see circleAddress.js.
const HKDF_INFO_NS = 'onderling-identity-v1:';
const HKDF_LEN     = 32;
const SALT_LEN     = 16;

/**
 * FIXED HKDF salt for per-profile agent-seed derivation (`deriveAgentSeed`).
 * **Permanent — never change.** Unlike `deriveResourceKey`'s per-resource random
 * salt (stored in the envelope), an agent seed must be reproducible from the phrase
 * ALONE — so the salt is a constant. Changing it would re-key every derived profile.
 */
const _AGENT_SEED_SALT = new TextEncoder().encode('onderling-agent-seed-v1');

/**
 * FIXED HKDF salt for the vault at-rest key (`deriveVaultAtRestKey`).
 * **Permanent — never change.** The at-rest key must be reproducible from the
 * phrase alone (the phrase is the unlock secret; nothing else is persisted),
 * so the salt is a constant. Changing it would make every encrypted vault
 * unreadable. Distinct from `_AGENT_SEED_SALT` so the at-rest key can never
 * collide with any profile's agent seed, whatever labels exist.
 */
const _VAULT_AT_REST_SALT = new TextEncoder().encode('onderling-vault-at-rest-v1');

/**
 * Root identity secret + key derivation.
 *
 * Construct via `Bootstrap.create()`, `Bootstrap.fromSeed(bytes)`, or
 * `Bootstrap.fromMnemonic(phrase)`.  Direct `new Bootstrap(...)` is
 * possible but the static factories validate inputs.
 */
export class Bootstrap {
  /** @type {Uint8Array} 32-byte bootstrap secret */
  #secret;
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array } | null} */
  #signKP = null;
  /** @type {Emitter} */
  #emitter = new Emitter();

  /**
   * @param {Uint8Array} secret  32-byte bootstrap seed.
   */
  constructor(secret) {
    if (!(secret instanceof Uint8Array) || secret.length !== SEED_LEN) {
      throw new Error(`Bootstrap secret must be a ${SEED_LEN}-byte Uint8Array`);
    }
    // Defensive copy — callers should not be able to mutate our internal
    // state by holding onto the input buffer.
    this.#secret = new Uint8Array(secret);
  }

  // ── Factories ───────────────────────────────────────────────────────────

  /**
   * Generate a fresh Bootstrap with a cryptographically random secret.
   *
   * @returns {{ bootstrap: Bootstrap, mnemonic: string }}
   *   The bootstrap instance plus the 24-word BIP-39 phrase the user must
   *   write down for recovery.
   */
  static create() {
    const secret = nacl.randomBytes(SEED_LEN);
    const bootstrap = new Bootstrap(secret);
    const mnemonic  = seedToMnemonic(secret);
    return { bootstrap, mnemonic };
  }

  /**
   * Restore a Bootstrap from raw seed bytes.
   *
   * @param   {Uint8Array} seedBytes  32-byte bootstrap secret.
   * @returns {Bootstrap}
   */
  static fromSeed(seedBytes) {
    return new Bootstrap(seedBytes);
  }

  /**
   * Restore a Bootstrap from a BIP-39 mnemonic phrase.
   *
   * @param   {string} mnemonic  24-word BIP-39 phrase (whitespace tolerated).
   * @returns {Bootstrap}
   * @throws  if the phrase fails BIP-39 validation.
   */
  static fromMnemonic(mnemonic) {
    if (typeof mnemonic !== 'string' || mnemonic.trim().length === 0) {
      throw new Error('Bootstrap.fromMnemonic: mnemonic must be a non-empty string');
    }
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Bootstrap.fromMnemonic: invalid BIP-39 mnemonic');
    }
    return new Bootstrap(mnemonicToSeed(mnemonic));
  }

  // ── Accessors ───────────────────────────────────────────────────────────

  /**
   * Raw bootstrap secret bytes.  Returns a defensive copy so callers cannot
   * mutate our internal state.  Intended for internal/test use.
   *
   * @returns {Uint8Array}
   */
  get secret() {
    return new Uint8Array(this.#secret);
  }

  /**
   * The BIP-39 mnemonic phrase encoding the bootstrap secret.
   *
   * @returns {string}
   */
  toMnemonic() {
    return seedToMnemonic(this.#secret);
  }

  // ── Key derivation ──────────────────────────────────────────────────────

  /**
   * Derive a per-resource symmetric encryption key.
   *
   * HKDF-SHA256 per `identity-pod-schema.md` §Encryption protocol →
   * §Key derivation:
   *
   *   K_resource = HKDF-SHA256(
   *     ikm    = bootstrap_secret,
   *     salt   = <random per-resource salt, stored in envelope>,
   *     info   = "onderling-identity-v1:" + relative-resource-path,
   *     length = 32 bytes
   *   )
   *
   * The salt is caller-supplied — it is generated fresh per resource on
   * write and stored in the envelope (`envelope.salt`) for read.
   *
   * @param   {string}     relativePath  e.g. "/devices/device-9f3a….enc"
   * @param   {Uint8Array} salt          16-byte per-resource salt.
   * @returns {Uint8Array} 32-byte derived key.
   */
  deriveResourceKey(relativePath, salt) {
    if (typeof relativePath !== 'string' || relativePath.length === 0) {
      throw new Error('deriveResourceKey: relativePath must be a non-empty string');
    }
    if (!(salt instanceof Uint8Array) || salt.length !== SALT_LEN) {
      throw new Error(`deriveResourceKey: salt must be a ${SALT_LEN}-byte Uint8Array`);
    }
    const info = new TextEncoder().encode(HKDF_INFO_NS + relativePath);
    // `@noble/hashes/hkdf` returns a fresh Uint8Array — no aliasing,
    // so callers cannot reach back into the source buffer.
    return hkdf(sha256, this.#secret, salt, info, HKDF_LEN);
  }

  /**
   * Derive a deterministic 32-byte Ed25519 **agent seed** for a labelled profile
   * (`'default'`, `'chat'`, a profileId, …). Feed the result into
   * `AgentIdentity.fromSeed(seed, vault)`.
   *
   *   seed = HKDF-SHA256(ikm=root_secret, salt=_AGENT_SEED_SALT (fixed),
   *                      info="onderling-identity-v1:agent-seed:" + label, len=32)
   *
   * The salt is FIXED (not per-resource-random like `deriveResourceKey`) precisely
   * so the same phrase + label re-derive the SAME seed on any device — the property
   * that makes one owner-root phrase recover every profile.
   *
   * @param   {string} label  stable per-profile label (never rename an existing one).
   * @returns {Uint8Array} 32-byte seed.
   */
  deriveAgentSeed(label) {
    if (typeof label !== 'string' || label.length === 0) {
      throw new Error('deriveAgentSeed: label must be a non-empty string');
    }
    const info = new TextEncoder().encode(`${HKDF_INFO_NS}agent-seed:${label}`);
    return hkdf(sha256, this.#secret, _AGENT_SEED_SALT, info, HKDF_LEN);
  }

  /**
   * The symmetric key that encrypts a device's vault at rest (see
   * `VaultEncrypted` in @onderling/vault). Deterministic from the phrase alone —
   * the phrase is the unlock secret; no copy of the key (or the phrase) is
   * persisted. Its own fixed salt keeps it domain-separated from every agent
   * seed, so unlocking the vault never exposes key material any identity signs with.
   *
   * @returns {Uint8Array} 32-byte key.
   */
  deriveVaultAtRestKey() {
    return deriveVaultAtRestKeyFrom(this.#secret);
  }

  /**
   * The delegation-custody twin (the custody cutover): derive the vault-at-rest key from ANY
   * 32-byte seed — on an enrolled device the DELEGATION seed replaces the root as the sealing
   * root, so the device's vaults open without the root ever being resident. Same salt + info as
   * the instance method (one derivation, two possible inputs); a different input yields an
   * unrelated key, which is exactly the reseal the migration performs.
   * @param {Uint8Array} seed  32 bytes.
   * @returns {Uint8Array} 32-byte key.
   */
  static deriveVaultAtRestKeyFrom(seed) {
    return deriveVaultAtRestKeyFrom(seed);
  }

  /**
   * Generate a fresh 16-byte salt suitable for `deriveResourceKey`.
   * Convenience helper — callers may also use `nacl.randomBytes(16)` or
   * `crypto.randomBytes(16)` directly.
   *
   * @returns {Uint8Array}
   */
  static randomSalt() {
    return nacl.randomBytes(SALT_LEN);
  }

  // ── Fingerprint ─────────────────────────────────────────────────────────

  /**
   * Derive the Ed25519 keypair from the bootstrap secret.
   *
   * Note: this is the **bootstrap key**, not the per-device agent identity.
   * It is a stable, deterministic derivation from the root secret used to
   * tie device records to a single owner via `dw:bootstrapKeyFingerprint`.
   * The agent's signing/encryption identity (Track B will store a separate
   * device-scoped seed in the platform vault) is independent.
   *
   * @returns {{ publicKey: Uint8Array, secretKey: Uint8Array }}
   */
  #ensureSignKP() {
    if (!this.#signKP) {
      this.#signKP = nacl.sign.keyPair.fromSeed(this.#secret);
    }
    return this.#signKP;
  }

  /**
   * Public Ed25519 key derived from the bootstrap secret.
   *
   * @returns {Uint8Array} 32-byte raw pubkey.
   */
  derivedPubKey() {
    return new Uint8Array(this.#ensureSignKP().publicKey);
  }

  /**
   * Compute the schema's `<pubkey-fingerprint>` for a given Ed25519 pubkey.
   *
   * Per `identity-pod-schema.md` §Container layout:
   *   "first 16 hex chars of SHA-256 over the ed25519 pubkey"
   *
   * **NOTE on byte vs. hex-char counting:** the spec says "first 16 hex
   * chars".  16 hex chars = 8 bytes of SHA-256 output.  The launch prompt
   * paraphrased this as "first 16 bytes (32 hex chars)" — the spec text
   * wins.  This implementation returns 16 hex characters (8 bytes) to
   * match `Design-v3/identity-pod-schema.md` literally.
   *
   * @param   {Uint8Array} [pubKey]  raw 32-byte Ed25519 pubkey.  Defaults
   *                                  to the bootstrap-derived pubkey
   *                                  (matches `dw:bootstrapKeyFingerprint`
   *                                  semantics).
   * @returns {string} 16 hex-character fingerprint.
   */
  fingerprint(pubKey) {
    const key = pubKey ?? this.derivedPubKey();
    if (!(key instanceof Uint8Array) || key.length !== 32) {
      throw new Error('fingerprint: pubKey must be a 32-byte Uint8Array');
    }
    const digest = sha256(key);
    let hex = '';
    for (let i = 0; i < digest.length; i++) hex += digest[i].toString(16).padStart(2, '0');
    return hex.slice(0, 16);
  }

  // ── Key-rotation hook (B1 step 6) ───────────────────────────────────────

  /**
   * Subscribe to bootstrap-level `key-rotated` notifications.  B2 will use
   * this to write `device-key-rotated` entries to the auth-log.
   *
   * **Important — KeyRotation is a static utility class with no event
   * emitter of its own.**  The existing rotation flow (`Agent.rotateIdentity`,
   * `AgentIdentity.rotate`, `KeyRotation.broadcast`) does not emit events.
   * Until that flow is wired through Bootstrap, callers performing a
   * rotation must invoke `bootstrap.notifyKeyRotated(proof)` themselves.
   *
   * TODO(B2): when `IdentityPodStore.appendAuthEvent` is implemented,
   * decide whether the hook lives on `Agent` (cleaner) or on `Bootstrap`
   * (matches the launch prompt).  If it moves to `Agent`, this method
   * becomes a thin re-export.
   *
   * @param   {(proof: object) => void} callback
   * @returns {() => void} unsubscribe function.
   */
  onKeyRotated(callback) {
    if (typeof callback !== 'function') {
      throw new Error('onKeyRotated: callback must be a function');
    }
    this.#emitter.on('key-rotated', callback);
    return () => this.#emitter.off('key-rotated', callback);
  }

  /**
   * Manually fire a `key-rotated` event.  Called by the rotation flow
   * (`Agent.rotateIdentity`) so subscribers can persist auth-log entries.
   *
   * @param {object} proof  the `KeyRotationProof` produced by
   *                        `KeyRotation.buildProof(...)`.
   */
  notifyKeyRotated(proof) {
    this.#emitter.emit('key-rotated', proof);
  }
}

/**
 * The ONE vault-at-rest derivation (module-level so both custody modes share it byte-for-byte):
 * root custody feeds the root secret; delegation custody feeds the device's delegation seed.
 * @param {Uint8Array} seed  32 bytes.
 * @returns {Uint8Array} 32-byte key.
 */
export function deriveVaultAtRestKeyFrom(seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== SEED_LEN) {
    throw new Error('deriveVaultAtRestKeyFrom: seed must be a 32-byte Uint8Array');
  }
  const info = new TextEncoder().encode(`${HKDF_INFO_NS}vault-at-rest`);
  return hkdf(sha256, seed, _VAULT_AT_REST_SALT, info, HKDF_LEN);
}
