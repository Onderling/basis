/**
 * CloudBackup — encrypted off-device backup of the identity bootstrap secret.
 *
 * Track C / C1 deliverable.  Wraps a `Bootstrap` and a `CloudAdapter`,
 * serializing the bootstrap secret + recovery hints into a single
 * passphrase-encrypted envelope and uploading it to the user's chosen cloud
 * backend (the `CloudAdapter` instance).
 *
 * Locked Q-C answers (do not relitigate — see launch prompt):
 *   - Q-C.1: payload = `bootstrap_secret + recovery_hints`.  Opt-in
 *     `includeFullPod` carries a `PodExporter` archive (Track C3) bundled
 *     into the same encrypted blob.
 *   - Q-C.2: encryption uses a separate user passphrase, stretched via
 *     **Argon2id** (`m=64MB, t=3, p=1`).  Salt + Argon2 params live in the
 *     plaintext envelope; ciphertext via `nacl.secretbox`.
 *   - Q-C.3: bundle-archive primary format = Solid LDP archive (handled by
 *     C3, opaque to C1).
 *   - Q-C.5: cloud adapter selection parked.  C1 ships only the
 *     `CloudAdapter` interface + `MemoryAdapter` for tests.
 *
 * Envelope on the wire (JSON, then UTF-8 encoded):
 *   {
 *     v:     1,
 *     alg:   'argon2id+xsalsa20poly1305',
 *     argon: { m: 65536, t: 3, p: 1 },   // KiB, iterations, parallelism
 *     salt:  '<base64url, 16 bytes>',
 *     nonce: '<base64url, 24 bytes>',
 *     ct:    '<base64url, ciphertext>',
 *   }
 *
 * Plaintext payload (after decrypt):
 *   {
 *     v: 1,
 *     bootstrap: '<base64url, 32 bytes>',     // Bootstrap.secret
 *     hints:     [ RecoveryHint, ... ],        // identity-pod-schema RecoveryHint records
 *     fullPod?:  '<base64url>',                // present only when includeFullPod was used
 *   }
 *
 * Spec refs:
 *   - `coding-plans/track-C-recovery-backup.md` §C1.
 *   - `Design-v3/identity-pod-schema.md` §RecoveryHint.
 */
import nacl              from 'tweetnacl';
import { argon2id }      from '@noble/hashes/argon2.js';

import { Bootstrap }                       from './Bootstrap.js';
import { encode as b64encode,
         decode as b64decode }             from '../crypto/b64.js';

const ENVELOPE_VERSION = 1;
const PAYLOAD_VERSION  = 1;
const ALG              = 'argon2id+xsalsa20poly1305';
const DEFAULT_REF      = 'onderling-cloud-backup.enc';
const SALT_LEN         = 16;
const NONCE_LEN        = 24;     // nacl.secretbox.nonceLength
const KEY_LEN          = 32;     // nacl.secretbox.keyLength

// Production Argon2id cost parameters (Q-C.2: m=64MB, t=3, p=1).
const PROD_ARGON_OPTS = Object.freeze({ m: 64 * 1024, t: 3, p: 1 });

const utf8encode = (s) => new TextEncoder().encode(s);
const utf8decode = (b) => new TextDecoder().decode(b);

/**
 * Stretch `passphrase` with Argon2id using `salt` and `opts` ({ m, t, p }).
 * Returns a 32-byte symmetric key.
 *
 * Wrapped as an internal helper so tests can override (the test override is
 * NOT a public API; it exists only because Argon2id at production cost is
 * deliberately slow).
 *
 * @param {string}     passphrase
 * @param {Uint8Array} salt
 * @param {{ m: number, t: number, p: number }} opts
 * @returns {Uint8Array}
 */
function _argon2id(passphrase, salt, opts) {
  return argon2id(passphrase, salt, {
    m:     opts.m,
    t:     opts.t,
    p:     opts.p,
    dkLen: KEY_LEN,
  });
}

/**
 * CloudBackup — orchestrates encrypt/upload + download/decrypt against a
 * `CloudAdapter`.
 *
 * Construct once per (adapter, ref) pair.  The instance is stateless beyond
 * its constructor args: each `upload`/`restore` call performs a fresh round
 * trip.
 */
export class CloudBackup {
  /** @type {import('./CloudAdapter.js').CloudAdapter} */
  #adapter;
  /** @type {string} */
  #ref;
  /** @type {{ m: number, t: number, p: number }} */
  #argonOpts;

  /**
   * @param {object} opts
   * @param {import('./CloudAdapter.js').CloudAdapter} opts.adapter
   *   Concrete adapter instance to read/write through.
   * @param {string} [opts.ref='onderling-cloud-backup.enc']
   *   Stable identifier for the backup blob inside the adapter.
   * @param {{ m: number, t: number, p: number }} [opts.argonOpts]
   *   **Test-only override** for Argon2id cost.  Production callers MUST
   *   omit this — the default is the locked Q-C.2 cost (`m=64MB, t=3, p=1`).
   *   Tests may pass e.g. `{ m: 1024, t: 1, p: 1 }` to keep the suite fast.
   */
  constructor({ adapter, ref = DEFAULT_REF, argonOpts } = {}) {
    if (!adapter || typeof adapter.put !== 'function' || typeof adapter.get !== 'function') {
      throw new Error('CloudBackup: adapter must implement the CloudAdapter interface');
    }
    if (typeof ref !== 'string' || ref.length === 0) {
      throw new Error('CloudBackup: ref must be a non-empty string');
    }
    this.#adapter   = adapter;
    this.#ref       = ref;
    this.#argonOpts = argonOpts
      ? { m: argonOpts.m, t: argonOpts.t, p: argonOpts.p }
      : { ...PROD_ARGON_OPTS };
  }

  /** Stable id this instance reads/writes. */
  get ref() {
    return this.#ref;
  }

  /**
   * Upload a fresh, freshly-encrypted backup, replacing any existing blob at
   * `this.ref`.
   *
   * @param {object}      opts
   * @param {Bootstrap}   opts.bootstrap         The Bootstrap whose secret is backed up.
   * @param {string}      opts.passphrase        User-supplied passphrase (separate from BIP-39 seed).
   * @param {object[]}    [opts.hints=[]]        RecoveryHint records (per identity-pod-schema).
   * @param {Uint8Array}  [opts.fullPodArchive]  Optional opaque PodExporter (C3) archive bytes.
   * @returns {Promise<{ ref: string, version?: string }>}
   */
  async upload({ bootstrap, passphrase, hints = [], fullPodArchive } = {}) {
    if (!(bootstrap instanceof Bootstrap)) {
      throw new Error('CloudBackup.upload: bootstrap must be a Bootstrap instance');
    }
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      throw new Error('CloudBackup.upload: passphrase must be a non-empty string');
    }
    if (!Array.isArray(hints)) {
      throw new Error('CloudBackup.upload: hints must be an array');
    }
    if (fullPodArchive !== undefined && !(fullPodArchive instanceof Uint8Array)) {
      throw new Error('CloudBackup.upload: fullPodArchive must be a Uint8Array');
    }

    // 1. Random per-backup salt + nonce.
    const salt  = nacl.randomBytes(SALT_LEN);
    const nonce = nacl.randomBytes(NONCE_LEN);

    // 2. Stretch passphrase → key.
    const key = _argon2id(passphrase, salt, this.#argonOpts);

    // 3. Build payload.
    const payload = {
      v:         PAYLOAD_VERSION,
      bootstrap: b64encode(bootstrap.secret),
      hints,
    };
    if (fullPodArchive) {
      payload.fullPod = b64encode(fullPodArchive);
    }
    const payloadBytes = utf8encode(JSON.stringify(payload));

    // 4. Encrypt.
    const ct = nacl.secretbox(payloadBytes, nonce, key);

    // 5. Wrap envelope (Argon2 params included so restore can re-derive
    //    even if defaults change in future versions).
    const envelope = {
      v:     ENVELOPE_VERSION,
      alg:   ALG,
      argon: { ...this.#argonOpts },
      salt:  b64encode(salt),
      nonce: b64encode(nonce),
      ct:    b64encode(ct),
    };
    const envelopeBytes = utf8encode(JSON.stringify(envelope));

    // 6. Hand off to the cloud adapter.
    return this.#adapter.put(this.#ref, envelopeBytes);
  }

  /**
   * Download + decrypt the backup.
   *
   * @param   {object} opts
   * @param   {string} opts.passphrase
   * @returns {Promise<{ bootstrap: Bootstrap, hints: object[], fullPodArchive?: Uint8Array }>}
   * @throws  Error with `code` `'CLOUD_BACKUP_NOT_FOUND'`,
   *          `'CLOUD_BACKUP_MALFORMED'`, `'CLOUD_BACKUP_UNSUPPORTED_VERSION'`,
   *          or `'CLOUD_BACKUP_DECRYPT_FAILED'` (wrong passphrase or
   *          tampered ciphertext).
   */
  async restore({ passphrase } = {}) {
    if (typeof passphrase !== 'string' || passphrase.length === 0) {
      throw new Error('CloudBackup.restore: passphrase must be a non-empty string');
    }

    // 1. Fetch.
    const bytes = await this.#adapter.get(this.#ref);
    if (!bytes) throw _err('CLOUD_BACKUP_NOT_FOUND', `no backup at ref "${this.#ref}"`);

    // 2. Parse envelope.
    let env;
    try {
      env = JSON.parse(utf8decode(bytes));
    } catch {
      throw _err('CLOUD_BACKUP_MALFORMED', 'envelope is not valid JSON');
    }
    if (!env || typeof env !== 'object'
        || env.alg !== ALG
        || !env.argon || typeof env.argon !== 'object'
        || typeof env.salt !== 'string'
        || typeof env.nonce !== 'string'
        || typeof env.ct !== 'string') {
      throw _err('CLOUD_BACKUP_MALFORMED', 'envelope is missing required fields');
    }
    if (env.v !== ENVELOPE_VERSION) {
      throw _err('CLOUD_BACKUP_UNSUPPORTED_VERSION', `envelope version ${env.v} not supported`);
    }

    // 3. Re-derive key with the envelope's params.
    const salt = b64decode(env.salt);
    const key  = _argon2id(passphrase, salt, env.argon);

    // 4. Decrypt — null = wrong passphrase or tamper.
    const ct    = b64decode(env.ct);
    const nonce = b64decode(env.nonce);
    const plain = nacl.secretbox.open(ct, nonce, key);
    if (!plain) {
      throw _err(
        'CLOUD_BACKUP_DECRYPT_FAILED',
        'failed to decrypt — wrong passphrase or tampered backup',
      );
    }

    // 5. Parse payload.
    let payload;
    try {
      payload = JSON.parse(utf8decode(plain));
    } catch {
      throw _err('CLOUD_BACKUP_MALFORMED', 'payload is not valid JSON');
    }
    if (!payload || payload.v !== PAYLOAD_VERSION || typeof payload.bootstrap !== 'string') {
      throw _err('CLOUD_BACKUP_MALFORMED', 'payload is missing required fields');
    }

    // 6. Reconstruct.
    const bootstrap = Bootstrap.fromSeed(b64decode(payload.bootstrap));
    const hints     = Array.isArray(payload.hints) ? payload.hints : [];
    const result    = { bootstrap, hints };
    if (typeof payload.fullPod === 'string') {
      result.fullPodArchive = b64decode(payload.fullPod);
    }
    return result;
  }

  /**
   * Best-effort existence check.  Does NOT throw if missing or if the
   * adapter returns null — only surfaces transport-level errors.
   *
   * @returns {Promise<boolean>}
   */
  async exists() {
    const bytes = await this.#adapter.get(this.#ref);
    return bytes !== null && bytes !== undefined;
  }

  /**
   * Hard-delete the backup blob from the adapter.
   *
   * @returns {Promise<void>}
   */
  async deleteRemote() {
    await this.#adapter.delete(this.#ref);
  }
}

/**
 * Build a typed Error with a stable `code` field.
 * @param {string} code
 * @param {string} message
 */
function _err(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}
