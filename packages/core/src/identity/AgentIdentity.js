/**
 * AgentIdentity — Ed25519 keypair + nacl.box encryption + a separate
 * `stableId` (Pinboard V1 Phase 11, 2026-05-06).
 *
 * The agent's *network* identity is its Ed25519 public key (replaced only
 * by `Agent.swapIdentity()`, the restore path).  The agent's *stable* identity is
 * `stableId` — opaque base64url, generated once at first construction,
 * persisted in the vault under `'agent-stable-id'`, **untouched by
 * rotation**.  Apps use it as the "this person" key for mute / ban /
 * report / peer-cache.  Existing vaults that pre-date this field
 * lazy-init on first load.
 *
 * The same 32-byte seed drives both signing (Ed25519 via tweetnacl)
 * and encryption (Curve25519 via ed2curve). The private key stays in
 * the Vault; operations are synchronous once the identity is constructed.
 *
 * Key conversion: ed2curve maps Ed25519 → Curve25519 so that the single
 * Ed25519 keypair is enough for both signing and nacl.box encryption. Both
 * parties derive the same Diffie-Hellman session key from their respective
 * Ed25519 identities.
 */
import nacl       from 'tweetnacl';
import ed2curve   from 'ed2curve';
// `node:crypto` is shimmed on React Native — use the pure-JS HKDF
// from `@noble/hashes` (already a core dep). Output is byte-identical
// to Node's `crypto.hkdfSync('sha256', seed, salt, info, len)`.
import { hkdf }   from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { verifyEd25519Strict } from '../crypto/ed25519Strict.js';
import { mnemonicToSeed, seedToMnemonic } from './Mnemonic.js';
import { ed25519KeyPairFromSeed, ed25519Sign } from '../crypto/ed25519Sign.js';   // signing + derivation behind the port a shell may speed up (L619)

import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

const { convertPublicKey, convertKeyPair } = ed2curve;

// THE BOX KEYS, REMEMBERED (ledger L619: a phone start's greeting burst spent ~2.9 s converting the same peer keys and
// deriving the same shared keys again in pure JS, at every send). Both memos are in memory only, bounded, never written
// anywhere and never logged; a key that changes (a peer's rotation) is a different key and simply misses.
/** How many peers' Curve25519 public keys are kept converted (public data, shared by every identity in the process). */
const CURVE_KEY_MEMO_MAX = param({ key: 'identity.curveKeyMemoMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 512 });
/** How many peers' shared (box.before) keys ONE identity keeps; past it the oldest is derived again on next use. */
const SHARED_KEY_MEMO_MAX = param({ key: 'identity.sharedKeyMemoMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 256 });
/** Ed25519 public key (base64url, the full key) → its Curve25519 image. A public key's image is public too. */
const curveKeys = new Map();
function curvePublicKeyOf(pubKeyB64) {
  const hit = curveKeys.get(pubKeyB64);
  if (hit) return hit;
  const curve = convertPublicKey(b64decode(pubKeyB64));
  if (!curve) return null;   // an invalid key is never remembered: it fails again, the same way
  if (curveKeys.size >= Number(CURVE_KEY_MEMO_MAX)) curveKeys.delete(curveKeys.keys().next().value);
  curveKeys.set(pubKeyB64, curve);
  return curve;
}

/** Vault key for the per-agent stableId (Pinboard V1 Phase 11). */
const STABLE_ID_KEY = 'agent-stable-id';

/**
 * Vault key for the per-install deviceId (Pinboard.1, 2026-05-06).
 *
 * Unlike `stableId`, `deviceId` is **install-scoped**: a fresh random UUID
 * generated once per install, persisted in the vault, NEVER derived from
 * the seed.  Restoring a mnemonic onto a different install produces the
 * SAME stableId (cross-device user identity) but a DIFFERENT deviceId
 * (fresh per-install hardware identity).  Apps use it to scope
 * device-specific settings on the pod.
 */
const DEVICE_ID_KEY = 'agent-device-id';

/**
 * HKDF salt for deterministic stableId derivation (+ Phase 32,
 * 2026-05-07).  **Permanent** — never change.  Changing it would
 * invalidate every restored identity's stableId across all apps.
 */
const STABLE_ID_HKDF_SALT = 'pinboard-stableId-v1';
const STABLE_ID_BYTES = 16;

/**
 * Derive a deterministic stableId from a seed using HKDF-SHA256.
 * Same seed → same stableId, on any device, always.  Used when a
 * vault is fresh (no existing stableId) AND a seed is available
 * (i.e. caller is `generate`, `restore`, or `fromMnemonic`).
 */
const _STABLE_ID_SALT_BYTES = new TextEncoder().encode(STABLE_ID_HKDF_SALT);
const _EMPTY_INFO            = new Uint8Array(0);

function _deriveStableIdFromSeed(seed) {
  const out = hkdf(sha256, seed, _STABLE_ID_SALT_BYTES, _EMPTY_INFO, STABLE_ID_BYTES);
  return b64encode(out);
}

/**
 * Load (or lazy-init) the stableId for this vault.  Returns null for
 * detached identities (vault === null) — those intentionally don't
 * persist anywhere.
 *
 * when the vault has nothing AND a
 * `seed` is supplied, derive the stableId deterministically via
 * HKDF-SHA256(seed, salt='pinboard-stableId-v1').  This makes
 * `restoreFromMnemonic` produce the SAME stableId across devices —
 * mute / report / contact-cache state survives the restore.
 *
 * Existing vaults with a random stableId keep theirs (back-compat).
 */
async function _loadOrInitStableId(vault, seed = null) {
  if (!vault) return null;
  const existing = await vault.get(STABLE_ID_KEY);
  if (existing && typeof existing === 'string' && existing.length > 0) return existing;
  const fresh = (seed instanceof Uint8Array && seed.length === 32)
    ? _deriveStableIdFromSeed(seed)
    : b64encode(nacl.randomBytes(16));
  await vault.set(STABLE_ID_KEY, fresh);
  return fresh;
}

/**
 * Load (or lazy-init) the per-install deviceId.  Returns null for
 * detached identities (vault === null).  Always random — never derived
 * from the seed; that's the whole point of the split.  UUIDv4 (36-char
 * canonical form) so it's recognisable in logs and pod paths.
 */
function _randomUuidV4() {
  const b = nacl.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;       // version 4
  b[8] = (b[8] & 0x3f) | 0x80;       // RFC 4122 variant
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`;
}
async function _loadOrInitDeviceId(vault) {
  if (!vault) return null;
  const existing = await vault.get(DEVICE_ID_KEY);
  if (existing && typeof existing === 'string' && existing.length > 0) return existing;
  const fresh = _randomUuidV4();
  await vault.set(DEVICE_ID_KEY, fresh);
  return fresh;
}

/**
 * An agent's cryptographic identity: an Ed25519 signing keypair plus the Curve25519
 * keypair derived from it for nacl.box encryption, both from one 32-byte seed. Also
 * carries `stableId` (rotation-surviving user id) and `deviceId` (per-install id),
 * persisted in the vault. Construct via the static factories (`generate`, `restore`,
 * `fromMnemonic`, `fromSeed`, …) so seed persistence and id init happen.
 */
export class AgentIdentity {
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array }} */
  #signKP;
  /** @type {{ publicKey: Uint8Array, secretKey: Uint8Array }} */
  #boxKP = null;
  /** peer Ed25519 public key (base64url, the full key) → the shared key with THIS identity's box secret. In memory only. */
  #sharedKeys = new Map();
  #vault;
  /** @type {string | null} — the stable opaque user id (Pinboard V1 Phase 11). */
  #stableId = null;
  /** @type {string | null} — per-install device id (Pinboard.1). */
  #deviceId = null;

  constructor({ seed, vault, stableId = null, deviceId = null }) {
    this.#vault  = vault;
    this.#signKP = ed25519KeyPairFromSeed(seed);
    // the Curve25519 pair is derived on first use: an identity that only signs (most of a start's) never pays for it
    this.#stableId = stableId;
    this.#deviceId = deviceId;
  }

  // ── Factory methods ────────────────────────────────────────────────────────

  /** Generate a new keypair, persist the seed to the vault. */
  static async generate(vault) {
    const seed = nacl.randomBytes(32);
    await vault.set('agent-privkey', _writeEntry(seed, null));
    const stableId = await _loadOrInitStableId(vault, seed);
    const deviceId = await _loadOrInitDeviceId(vault);
    return new AgentIdentity({ seed, vault, stableId, deviceId });
  }

  /** Restore an existing keypair from the vault. */
  static async restore(vault) {
    const raw = await vault.get('agent-privkey');
    if (!raw) throw new Error('No agent key found in vault');
    const parsed = _parseEntry(raw);
    const seed = b64decode(parsed.current);
    const stableId = await _loadOrInitStableId(vault, seed);
    const deviceId = await _loadOrInitDeviceId(vault);
    return new AgentIdentity({ seed, vault, stableId, deviceId });
  }

  /**
   * Restore (or create) a keypair from a BIP39 mnemonic.
   * Persists the seed to vault — same behaviour as generate().
   */
  static async fromMnemonic(mnemonic, vault) {
    const seed = mnemonicToSeed(mnemonic);
    await vault.set('agent-privkey', _writeEntry(seed, null));
    const stableId = await _loadOrInitStableId(vault, seed);
    const deviceId = await _loadOrInitDeviceId(vault);
    return new AgentIdentity({ seed, vault, stableId, deviceId });
  }

  /**
   * Build an identity from a supplied 32-byte seed, persisting it to the vault —
   * same shape as `fromMnemonic`, minus the mnemonic→seed step.  This is the seam
   * for owner-root derivation: a profile's seed = `Bootstrap.deriveAgentSeed(label)`,
   * so the resulting pubKey + (HKDF-derived) stableId are a deterministic function
   * of the owner root's phrase and re-derive identically on any device.
   *
   * @param {Uint8Array} seedBytes  exactly 32 bytes (Ed25519 seed).
   * @param {import('./Vault.js').Vault} vault
   */
  static async fromSeed(seedBytes, vault) {
    if (!(seedBytes instanceof Uint8Array) || seedBytes.length !== 32) {
      throw new Error('AgentIdentity.fromSeed: seedBytes must be a 32-byte Uint8Array');
    }
    await vault.set('agent-privkey', _writeEntry(seedBytes, null));
    const stableId = await _loadOrInitStableId(vault, seedBytes);
    const deviceId = await _loadOrInitDeviceId(vault);
    return new AgentIdentity({ seed: seedBytes, vault, stableId, deviceId });
  }

  /**
   * The pubKey a 32-byte seed WOULD yield — same encoding as `.pubKey`, WITHOUT a vault or
   * persistence. Lets a caller record a derived profile's pubKey in a registry (seed =
   * `Bootstrap.deriveAgentSeed(profileId)`) without materialising a full identity; the actual
   * identity is re-derived on the device that runs the profile.
   *
   * @param {Uint8Array} seedBytes  exactly 32 bytes (Ed25519 seed).
   * @returns {string} the base64 pubKey.
   */
  static pubKeyFromSeed(seedBytes) {
    if (!(seedBytes instanceof Uint8Array) || seedBytes.length !== 32) {
      throw new Error('AgentIdentity.pubKeyFromSeed: seedBytes must be a 32-byte Uint8Array');
    }
    return b64encode(ed25519KeyPairFromSeed(seedBytes).publicKey);
  }

  // ── Identity ───────────────────────────────────────────────────────────────

  /** Ed25519 public key as base64url string — changes only when the identity is replaced (`Agent.swapIdentity`). */
  get pubKey() {
    return b64encode(this.#signKP.publicKey);
  }

  /**
   * Stable opaque user identifier (Pinboard V1 Phase 11).  Generated once
   * at first construction (or lazy-init on legacy vaults), persisted
   * under `agent-stable-id`, **untouched by rotation**.  Apps use it
   * for the "this person" key (mute / ban / report / peer-cache).
   *
   * Kept in its own vault key (`agent-stable-id`), so a new keypair on the
   * same vault carries the same value.
   */
  get stableId() {
    return this.#stableId;
  }

  /**
   * Per-install device identifier (Pinboard.1, 2026-05-06).
   *
   * UUIDv4 string, generated once at first construction (or lazy-init
   * on legacy vaults), persisted under `agent-device-id`, **untouched
   * by rotation** (still the same install) but **fresh on every new
   * install** (mnemonic-restore on a fresh device gets a fresh value).
   *
   * Apps use it to scope device-specific settings on the pod —
   * e.g. `<pod>/<app>/settings/devices/<deviceId>.json`.  Returns null
   * for detached identities (vault === null).
   */
  get deviceId() {
    return this.#deviceId;
  }

  /**
   * The underlying Vault instance (may be null for "detached" identities
   * — those intentionally can't write back to the vault).
   */
  get vault() { return this.#vault; }

  /** Ed25519 public key as raw Uint8Array. */
  get pubKeyBytes() {
    return this.#signKP.publicKey;
  }

  /** Curve25519 public key bytes (derived from Ed25519 for nacl.box). */
  get boxPubKeyBytes() {
    return this.#box().publicKey;
  }

  /** This identity's Curve25519 key pair, derived once, on first use. */
  #box() {
    if (!this.#boxKP) {
      const kp = convertKeyPair(this.#signKP);
      if (!kp) throw new Error('Failed to derive Curve25519 keypair from seed');
      this.#boxKP = kp;
    }
    return this.#boxKP;
  }

  /**
   * The shared key with a peer (`nacl.box.before`), remembered on this identity by the peer's full public key. Exactly
   * the key `box`/`unbox` derived at every call before, so the bytes on the wire are unchanged.
   */
  #sharedKeyWith(peerPubKeyB64, role) {
    const hit = this.#sharedKeys.get(peerPubKeyB64);
    if (hit) return hit;
    const curve = curvePublicKeyOf(peerPubKeyB64);
    if (!curve) throw new Error(`Invalid ${role} Ed25519 public key`);
    const key = nacl.box.before(curve, this.#box().secretKey);
    if (this.#sharedKeys.size >= Number(SHARED_KEY_MEMO_MAX)) this.#sharedKeys.delete(this.#sharedKeys.keys().next().value);
    this.#sharedKeys.set(peerPubKeyB64, key);
    return key;
  }

  /** Return the BIP39 mnemonic for the current seed (reads from vault). */
  async getMnemonic() {
    if (!this.#vault) return null;
    const raw = await this.#vault.get('agent-privkey');
    if (!raw) return null;
    const parsed = _parseEntry(raw);
    return seedToMnemonic(b64decode(parsed.current));
  }

  // ── Signing ────────────────────────────────────────────────────────────────

  /**
   * Sign data with the Ed25519 private key.
   * @param   {string|Uint8Array} data
   * @returns {Uint8Array} 64-byte signature
   */
  sign(data) {
    if (typeof data === 'string') data = new TextEncoder().encode(data);
    return ed25519Sign(data, this.#signKP.secretKey);
  }

  /**
   * Verify an Ed25519 signature.
   * @param {string|Uint8Array} data
   * @param {string|Uint8Array} sig       - 64-byte signature (or base64url)
   * @param {string}            pubKeyB64 - signer's Ed25519 pubKey (base64url)
   */
  static verify(data, sig, pubKeyB64) {
    if (typeof data === 'string') data = new TextEncoder().encode(data);
    if (typeof sig  === 'string') sig  = b64decode(sig);
    // the platform's ONE check: the strict byte rule, then the equation (crypto/ed25519Strict.js)
    return verifyEd25519Strict(data, sig, b64decode(pubKeyB64));
  }

  // ── Asymmetric encryption ──────────────────────────────────────────────────

  /**
   * Encrypt plaintext for a recipient identified by their Ed25519 public key.
   * Uses Curve25519 DH + XSalsa20-Poly1305 (nacl.box).
   *
   * @param   {Uint8Array} plaintext
   * @param   {string}     recipientPubKeyB64 — recipient's Ed25519 pubKey (base64url)
   * @returns {{ nonce: Uint8Array, ciphertext: Uint8Array }}
   */
  box(plaintext, recipientPubKeyB64) {
    const sessionKey = this.#sharedKeyWith(recipientPubKeyB64, 'recipient');
    const nonce      = nacl.randomBytes(nacl.box.nonceLength); // 24 bytes
    const ciphertext = nacl.box.after(plaintext, nonce, sessionKey);
    return { nonce, ciphertext };
  }

  /**
   * Decrypt a nacl.box ciphertext from a sender.
   *
   * @param   {Uint8Array} ciphertext
   * @param   {Uint8Array} nonce
   * @param   {string}     senderPubKeyB64 — sender's Ed25519 pubKey (base64url)
   * @returns {Uint8Array|null}  null if authentication fails
   */
  unbox(ciphertext, nonce, senderPubKeyB64) {
    const sessionKey = this.#sharedKeyWith(senderPubKeyB64, 'sender');
    return nacl.box.open.after(ciphertext, nonce, sessionKey);
  }

  /**
   * Derive a shared symmetric session key with a peer (for stream encryption).
   * Both sides compute nacl.box.before from their respective keypairs and arrive
   * at the same 32-byte key — no extra message exchange needed.
   *
   * @param   {string}     peerPubKeyB64 — peer's Ed25519 pubKey (base64url)
   * @returns {Uint8Array} 32-byte session key
   */
  deriveSessionKey(peerPubKeyB64) {
    // a copy: the caller may hold or wipe its key; the remembered one is never handed out
    return Uint8Array.from(this.#sharedKeyWith(peerPubKeyB64, 'peer'));
  }

  // ── Sealed shared-copy opener (SILENT out-of-circle delivery) ────────────────

  /**
   * Build a per-text OPENER for sealed "shared with me" copies addressed to
   * this agent's PUBLISHED network key — WITHOUT ever surfacing the network
   * secret to the caller.
   *
   * A silent out-of-circle share seals a COPY to the recipient's X25519
   * SEALING public key, which the SENDER derives from this agent's published
   * Ed25519 network key (`@onderling/pod-client` `sealingPublicKeyFromNetworkKey`).
   * The recipient opens it with the matching SEALING PRIVATE key, derived from
   * its OWN network secret via the counterpart `sealingKeyPairFromNetworkKey`.
   *
   * LAYERING (invariant #5): that X25519 derivation + the envelope `open` live
   * in the `@onderling/pod-client` ADAPTER, and the kernel must NOT depend UP on an
   * adapter. So the caller INJECTS the adapter as `deriveOpener` — a pure
   * `(networkSecretB64) => ((text) => plaintext)` builder the app wires to
   * `sealingKeyPairFromNetworkKey` + `makeOpener`. This method hands the builder
   * the raw network secret INTERNALLY and returns ONLY the resulting opener
   * CLOSURE. The secret / derived private key is NEVER returned or otherwise
   * exposed to callers — the closure is the sole thing that escapes.
   *
   * @param {(networkSecretB64:string)=>((text:string)=>string|Promise<string>)} deriveOpener
   * @returns {(text:string)=>string|Promise<string>}  a per-text opener closure
   */
  sharedCopyOpener(deriveOpener) {
    if (typeof deriveOpener !== 'function') {
      throw new Error('sharedCopyOpener: a deriveOpener(networkSecretB64) builder is required');
    }
    // The 64-byte Ed25519 secret key IS the network secret `sealingKeyPairFromNetworkKey`
    // pairs with `sealingPublicKeyFromNetworkKey(pubKey)` (both run the same ed2curve map).
    const opener = deriveOpener(b64encode(this.#signKP.secretKey));
    if (typeof opener !== 'function') {
      throw new Error('sharedCopyOpener: deriveOpener must return an opener function');
    }
    return opener;
  }

  // ── Symmetric encryption ───────────────────────────────────────────────────

  /**
   * Encrypt with a pre-shared session key (nacl.secretbox / XSalsa20-Poly1305).
   * Used for stream chunks (ST/SE/BT) where nonce is derived from streamId+seq.
   *
   * @param   {Uint8Array} plaintext
   * @param   {Uint8Array} nonce      — 24 bytes
   * @param   {Uint8Array} sessionKey — 32 bytes (from deriveSessionKey)
   * @returns {Uint8Array}
   */
  static secretbox(plaintext, nonce, sessionKey) {
    return nacl.secretbox(plaintext, nonce, sessionKey);
  }

  /**
   * Decrypt with a session key.
   * @returns {Uint8Array|null} null if authentication fails
   */
  static secretunbox(ciphertext, nonce, sessionKey) {
    return nacl.secretbox.open(ciphertext, nonce, sessionKey);
  }
}

// ── Vault envelope helpers ───────────────────────────────────────────────────
//
// The vault holds a JSON blob with a `current` seed (b64) under 'agent-privkey' (or, oldest, a bare base64url seed,
// read as current-only). A `previous` field, written by the retired push rotation, is read past and never used.

function _parseEntry(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return { current: '', previous: null };
  // Try JSON first.
  if (raw[0] === '{') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.current === 'string') {
        return {
          current:  parsed.current,
          previous: parsed.previous ?? null,
        };
      }
    } catch { /* fall through to legacy */ }
  }
  // Legacy bare-b64 seed.
  return { current: raw, previous: null };
}

function _writeEntry(seed, previous) {
  return JSON.stringify({
    current:  typeof seed === 'string' ? seed : b64encode(seed),
    previous: previous ?? null,
  });
}
