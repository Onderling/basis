/**
 * IdentityPodStore — Track B / B2.
 *
 * Implements the on-pod side of `Design-v3/identity-pod-schema.md`:
 *   • encrypts each identity resource per the schema's encryption-protocol
 *     (XSalsa20-Poly1305 envelope, per-resource HKDF-SHA256 key).
 *   • walks the `/onderling/` container and computes the deterministic
 *     `dw:contentHash` per the schema's 6-step algorithm.
 *   • signs the plaintext `manifest.ttl` with an `AgentIdentity`.
 *   • appends to `auth-log/YYYY-MM.enc` in JSON-LD Lines format.
 *
 * --- v1 schema deviation (intentional) ----------------------------------
 *
 * The schema specifies that decrypted resources (Device, Contact, …) are
 * **Turtle**.  This v1 implementation stores per-resource records as
 * **plain JSON inside the encryption envelope**, not Turtle.
 *
 * Rationale:
 *   - The decrypted bytes are only ever read by the SDK itself; there is
 *     no third-party Turtle consumer for v1 (apps query through the SDK).
 *   - Hand-rolling a Turtle round-trip for arbitrary record shapes adds
 *     code surface (lists, datatyped literals, blank nodes) without
 *     v1 value.  Pulling in `n3.js` would add a new top-level dep.
 *   - The encryption envelope is unchanged; a future migration that adds
 *     a Turtle codec on the plaintext side does NOT require re-encrypting
 *     existing resources.
 *
 * The `manifest.ttl` is still real Turtle — that's the only file an
 * external client needs to parse before being able to do anything else,
 * and `serializeManifest` plus `parseManifest` cover its narrow shape.
 *
 * Auth-log files (`auth-log/YYYY-MM.enc`) are still JSON-LD Lines — the
 * decrypted bytes match the schema literally.
 *
 * Tracked in `coding-plans/track-B-identity-sync.md` §B2 scratchpad.
 *
 * --- known concurrency edge case (Q-B.3, locked 2026-04-29) ------------
 *
 * Manifest writes use LWW-with-retry, max 3 retries.  If two devices
 * both modify the SAME record (e.g. both rotating the same key) within
 * a tight window, the loser's change is invisible until they re-apply —
 * the loser sees `ConflictError` from `writeResource` and is expected
 * to retry.  v2 fallback: per-device manifest fragments merged on read.
 *
 * Reuses A7's `'conflict'` event surface on `PodClient`.  Callers may
 * subscribe via `podClient.on('conflict', resolver)` for richer merge
 * UI; the default policy here is `'reject'` so callers get an explicit
 * error rather than silent overwrites.
 */

import nacl  from 'tweetnacl';

import { b64encode, b64decode } from '@onderling/core';
import { Bootstrap }      from '@onderling/core';
import { AgentIdentity }  from '@onderling/core';
import {
  serializeManifest,
  parseManifest,
  serializeAuthEvent,
  parseAuthLog,
  authLogFileFor,
  computeContentHash,
  signManifest,
  verifyManifestSignature,
} from './identitySerializers/index.js';

const SCHEMA_VERSION  = '0.1.0';
const ENVELOPE_V1     = 1;
const ENVELOPE_ALG    = 'xsalsa20poly1305';
const NONCE_LEN       = 24;
const SALT_LEN        = 16;
const MANIFEST_FILE   = 'manifest.ttl';
const MAX_MANIFEST_RETRIES = 3;

// ── Envelope helpers ───────────────────────────────────────────────────────

/**
 * Wrap plaintext bytes in the schema's encryption envelope.  Per-resource
 * salt + path-as-info — fresh salt per write so repeated writes of the
 * same resource produce distinct envelopes.
 *
 * @param   {Bootstrap}  bootstrap
 * @param   {string}     relativePath  e.g. `'devices/device-9f3a2c1b.enc'`.
 * @param   {Uint8Array} plaintextBytes
 * @returns {string}      JSON-encoded envelope (UTF-8 string).
 */
export function encryptResource(bootstrap, relativePath, plaintextBytes) {
  if (!(bootstrap instanceof Bootstrap)) {
    throw new Error('encryptResource: bootstrap must be a Bootstrap instance');
  }
  if (!(plaintextBytes instanceof Uint8Array)) {
    throw new Error('encryptResource: plaintextBytes must be a Uint8Array');
  }
  const salt  = nacl.randomBytes(SALT_LEN);
  const key   = bootstrap.deriveResourceKey(relativePath, salt);
  const nonce = nacl.randomBytes(NONCE_LEN);
  const ct    = nacl.secretbox(plaintextBytes, nonce, key);
  return JSON.stringify({
    v:     ENVELOPE_V1,
    alg:   ENVELOPE_ALG,
    salt:  b64encode(salt),
    nonce: b64encode(nonce),
    ct:    b64encode(ct),
  });
}

/**
 * Inverse of `encryptResource`.  Throws on malformed envelope or MAC fail.
 *
 * @param   {Bootstrap} bootstrap
 * @param   {string}    relativePath
 * @param   {string}    envelopeJson
 * @returns {Uint8Array}
 */
export function decryptResource(bootstrap, relativePath, envelopeJson) {
  if (!(bootstrap instanceof Bootstrap)) {
    throw new Error('decryptResource: bootstrap must be a Bootstrap instance');
  }
  let env;
  try { env = JSON.parse(envelopeJson); }
  catch (cause) {
    throw Object.assign(new Error('IdentityPodStore: envelope is not valid JSON'), {
      code: 'IDENTITY_BAD_ENVELOPE', cause,
    });
  }
  if (env?.v !== ENVELOPE_V1) {
    throw Object.assign(new Error(`IdentityPodStore: unknown envelope version ${env?.v}`), {
      code: 'IDENTITY_BAD_ENVELOPE',
    });
  }
  if (env.alg !== ENVELOPE_ALG) {
    throw Object.assign(new Error(`IdentityPodStore: unknown envelope alg ${env.alg}`), {
      code: 'IDENTITY_BAD_ENVELOPE',
    });
  }
  let salt, nonce, ct;
  try {
    salt  = b64decode(env.salt);
    nonce = b64decode(env.nonce);
    ct    = b64decode(env.ct);
  } catch (cause) {
    throw Object.assign(new Error('IdentityPodStore: envelope contains malformed base64'), {
      code: 'IDENTITY_BAD_ENVELOPE', cause,
    });
  }
  const key   = bootstrap.deriveResourceKey(relativePath, salt);
  const plain = nacl.secretbox.open(ct, nonce, key);
  if (!plain) {
    throw Object.assign(new Error('IdentityPodStore: envelope decryption / MAC failed'), {
      code: 'IDENTITY_DECRYPT_FAILED',
    });
  }
  return plain;
}

// ── Path helpers ───────────────────────────────────────────────────────────

function joinUri(root, relative) {
  const base = root.endsWith('/') ? root : `${root}/`;
  let rel = relative;
  while (rel.startsWith('/')) rel = rel.slice(1);
  return base + rel;
}

function isManifestPath(relativePath) {
  let rel = relativePath;
  while (rel.startsWith('/')) rel = rel.slice(1);
  return rel === MANIFEST_FILE;
}

// ── Class ──────────────────────────────────────────────────────────────────

/**
 * High-level read / write / append / verify API for the identity
 * container in a Solid pod.
 */
export class IdentityPodStore {
  /** @type {object} */    #podClient;
  /** @type {Bootstrap} */ #bootstrap;
  /** @type {AgentIdentity} */ #identity;
  /** @type {string} */    #podRoot;        // e.g. 'https://alice.example/onderling/'
  /** @type {string} */    #rootPubKey;     // base64url Ed25519 pubkey of #identity.

  /**
   * @param {object} opts
   * @param {object}        opts.podClient   `@onderling/pod-client` PodClient.
   * @param {Bootstrap}     opts.bootstrap   Track B Bootstrap (root secret).
   * @param {AgentIdentity} opts.identity    root device identity (manifest signer).
   * @param {string}        opts.podRoot     pod-relative or absolute URI; the
   *                                          identity container will be at
   *                                          `<podRoot>/onderling/`.  If `podRoot`
   *                                          already ends in `/onderling/`, it
   *                                          is used as-is.
   */
  constructor({ podClient, bootstrap, identity, podRoot } = {}) {
    if (!podClient || typeof podClient.read !== 'function') {
      throw new Error('IdentityPodStore: podClient is required');
    }
    if (!(bootstrap instanceof Bootstrap)) {
      throw new Error('IdentityPodStore: bootstrap must be a Bootstrap');
    }
    if (!(identity instanceof AgentIdentity)) {
      throw new Error('IdentityPodStore: identity must be an AgentIdentity');
    }
    if (typeof podRoot !== 'string' || podRoot.length === 0) {
      throw new Error('IdentityPodStore: podRoot must be a non-empty string');
    }

    this.#podClient  = podClient;
    this.#bootstrap  = bootstrap;
    this.#identity   = identity;
    this.#rootPubKey = identity.pubKey;

    // Normalize: ensure podRoot ends with '/onderling/'.
    let root = podRoot;
    if (!root.endsWith('/')) root += '/';
    if (!root.endsWith('/onderling/')) root += 'onderling/';
    this.#podRoot = root;
  }

  /** Identity container root URI (always ending in `/onderling/`). */
  get root() { return this.#podRoot; }

  // ── init ────────────────────────────────────────────────────────────────

  /**
   * Bootstrap a fresh identity container.  Idempotent — if the manifest
   * already exists and verifies, this is a no-op; if it exists but fails
   * to verify, the call returns `{ created: false, verified: false }` so
   * the caller can decide (re-init vs. abort).
   *
   * @returns {Promise<{ created: boolean, verified: boolean, manifest: object }>}
   */
  async init() {
    const manifestUri = joinUri(this.#podRoot, MANIFEST_FILE);

    let existing = null;
    try {
      const res = await this.#podClient.read(manifestUri, { decode: 'string' });
      existing = parseManifest(res.content);
    } catch (err) {
      if (err?.code !== 'NOT_FOUND') throw err;
    }

    if (existing) {
      const verified = verifyManifestSignature(existing);
      return { created: false, verified, manifest: existing };
    }

    // Fresh container.  Manifest contentHash over an empty `.enc` set
    // hashes to SHA-256("") (the empty byte concatenation hashed).
    const manifest = await this.#regenerateManifest();
    return { created: true, verified: true, manifest };
  }

  // ── readResource / writeResource ────────────────────────────────────────

  /**
   * Read + decrypt + JSON-parse a resource.  Returns the raw record
   * object (the value the caller passed to `writeResource`).
   *
   * @param   {string} relativePath  e.g. `'devices/device-9f3a2c1b.enc'`.
   * @returns {Promise<object>}
   */
  async readResource(relativePath) {
    if (isManifestPath(relativePath)) {
      throw Object.assign(new Error('IdentityPodStore: use init()/verifyManifest() for the manifest, not readResource'), {
        code: 'INVALID_ARGUMENT',
      });
    }
    const uri = joinUri(this.#podRoot, relativePath);
    const res = await this.#podClient.read(uri, { decode: 'string' });
    const plain = decryptResource(this.#bootstrap, relativePath, res.content);
    const text  = new TextDecoder().decode(plain);
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw Object.assign(new Error('IdentityPodStore: decrypted payload is not valid JSON'), {
        code: 'IDENTITY_BAD_PAYLOAD', cause,
      });
    }
  }

  /**
   * Encrypt + write a resource, then regenerate + sign + write the
   * manifest.  See class JSDoc for the LWW-with-retry concurrency note.
   *
   * @param   {string} relativePath
   * @param   {object} contentObj   serialized as JSON (v1 deviation; see class JSDoc).
   * @returns {Promise<{ uri: string, manifest: object }>}
   */
  async writeResource(relativePath, contentObj) {
    if (isManifestPath(relativePath)) {
      throw Object.assign(new Error('IdentityPodStore: use init() to write the manifest'), {
        code: 'INVALID_ARGUMENT',
      });
    }
    if (!relativePath.endsWith('.enc')) {
      throw Object.assign(new Error(`IdentityPodStore: resource path must end in .enc (got '${relativePath}')`), {
        code: 'INVALID_ARGUMENT',
      });
    }

    const uri = joinUri(this.#podRoot, relativePath);
    const plaintext = new TextEncoder().encode(JSON.stringify(contentObj));
    const envelope  = encryptResource(this.#bootstrap, relativePath, plaintext);
    await this.#podClient.write(uri, envelope, {
      contentType: 'application/json',
      // Identity records are device-local snapshots; if a peer raced us
      // we usually want to win (vs. silently dropping the local change),
      // but the manifest is the truth.  Use lww here.
      conflictPolicy: 'lww',
    });

    const manifest = await this.#regenerateManifest();
    return { uri, manifest };
  }

  // ── auth-log ────────────────────────────────────────────────────────────

  /**
   * Append an auth event to the current month's auth-log file.  Reads
   * the existing file (if any), decrypts it, appends one JSON-LD line,
   * re-encrypts the whole thing, and writes back with retry on conflict.
   *
   * NOTE: full-file re-encrypt is acceptable for v1 because auth-log
   * files are monthly + sparse.  v2 may switch to streaming append-only
   * encryption if write rates climb.
   *
   * @param   {object}     event
   * @param   {string}     event.event
   * @param   {string}     [event.actor]
   * @param   {string}     [event.target]
   * @param   {string}     [event.at]      defaults to `new Date().toISOString()`.
   * @param   {object}     [event.metadata]
   * @param   {Date|string} [event.when]   month bucket selector; defaults to now.
   * @returns {Promise<{ uri: string, count: number }>}
   *          `count` is the number of events in the log AFTER the append.
   */
  async appendAuthEvent(event = {}) {
    if (typeof event.event !== 'string' || event.event.length === 0) {
      throw Object.assign(new Error('appendAuthEvent: event.event is required'), {
        code: 'INVALID_ARGUMENT',
      });
    }
    const at   = event.at ?? new Date().toISOString();
    const when = event.when ?? at;
    const month = authLogFileFor(when);
    const relativePath = `auth-log/${month}.enc`;
    const uri  = joinUri(this.#podRoot, relativePath);

    // Sign the canonical (signature-less) JSON form so tampering with
    // any earlier line is detectable on read.
    const canonicalEvent = {
      event:    event.event,
      actor:    event.actor,
      target:   event.target,
      at,
      metadata: event.metadata,
    };
    const sigBytes = this.#identity.sign(serializeAuthEvent(canonicalEvent));
    const signed = { ...canonicalEvent, signature: b64encode(sigBytes) };
    const newLine = serializeAuthEvent(signed);

    let lastErr;
    for (let attempt = 0; attempt <= MAX_MANIFEST_RETRIES; attempt++) {
      let existingPlain = '';
      let existed = false;
      try {
        const res = await this.#podClient.read(uri, { decode: 'string' });
        const plain = decryptResource(this.#bootstrap, relativePath, res.content);
        existingPlain = new TextDecoder().decode(plain);
        existed = true;
      } catch (err) {
        if (err?.code !== 'NOT_FOUND') throw err;
      }

      const tail = existingPlain.length === 0 || existingPlain.endsWith('\n')
        ? ''
        : '\n';
      const nextPlain = existingPlain + tail + newLine + '\n';
      const nextEnvelope = encryptResource(
        this.#bootstrap,
        relativePath,
        new TextEncoder().encode(nextPlain),
      );

      try {
        await this.#podClient.write(uri, nextEnvelope, {
          contentType: 'application/json',
          conflictPolicy: 'reject',
        });
        // Manifest hash needs refreshing only when the file is new — the
        // contentHash is over the envelope BYTES, which change each write.
        // So always regenerate (cheap; A7 will eventually batch).
        await this.#regenerateManifest();
        const count = parseAuthLog(nextPlain).length;
        return { uri, count, created: !existed };
      } catch (err) {
        if (err?.code === 'CONFLICT') {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? Object.assign(new Error('appendAuthEvent: retries exhausted'), { code: 'CONFLICT' });
  }

  /**
   * Read all events for a given month.  Returns `[]` if the log file
   * doesn't exist.
   *
   * @param   {Date|string} [when]  defaults to now.
   * @returns {Promise<object[]>}
   */
  async readAuthLog(when = new Date()) {
    const month = authLogFileFor(when);
    const relativePath = `auth-log/${month}.enc`;
    const uri = joinUri(this.#podRoot, relativePath);
    let res;
    try {
      res = await this.#podClient.read(uri, { decode: 'string' });
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return [];
      throw err;
    }
    const plain = decryptResource(this.#bootstrap, relativePath, res.content);
    return parseAuthLog(new TextDecoder().decode(plain));
  }

  // ── verifyManifest ──────────────────────────────────────────────────────

  /**
   * Re-walk the container, recompute `dw:contentHash`, verify the
   * stored signature, and compare.  Returns true iff the manifest is
   * intact AND its hash matches the live container.
   *
   * @returns {Promise<{ ok: boolean, reason?: string, expected?: string, actual?: string }>}
   */
  async verifyManifest() {
    const manifestUri = joinUri(this.#podRoot, MANIFEST_FILE);
    let parsed;
    try {
      const res = await this.#podClient.read(manifestUri, { decode: 'string' });
      parsed = parseManifest(res.content);
    } catch (err) {
      if (err?.code === 'NOT_FOUND') return { ok: false, reason: 'manifest-missing' };
      throw err;
    }

    if (!parsed.contentHash || !parsed.signature || !parsed.rootDevicePubkey) {
      return { ok: false, reason: 'manifest-incomplete' };
    }

    if (!verifyManifestSignature(parsed)) {
      return { ok: false, reason: 'signature-invalid' };
    }

    const recomputed = await computeContentHash(this.#podClient, this.#podRoot);
    if (recomputed !== parsed.contentHash) {
      return {
        ok:       false,
        reason:   'content-hash-mismatch',
        expected: parsed.contentHash,
        actual:   recomputed,
      };
    }
    return { ok: true };
  }

  // ── #regenerateManifest ─────────────────────────────────────────────────

  /**
   * Internal: walk the container, compute the content hash, sign the
   * manifest, and write it.  Uses LWW-with-retry on conflict (max 3
   * retries) — see class JSDoc.
   *
   * @returns {Promise<object>}  the manifest object that was written.
   */
  async #regenerateManifest() {
    const manifestUri = joinUri(this.#podRoot, MANIFEST_FILE);
    let lastErr;
    for (let attempt = 0; attempt <= MAX_MANIFEST_RETRIES; attempt++) {
      const contentHash = await computeContentHash(this.#podClient, this.#podRoot);
      const manifest = signManifest({
        schemaVersion:    SCHEMA_VERSION,
        lastUpdated:      new Date().toISOString(),
        rootDevicePubkey: this.#rootPubKey,
        contentHash,
      }, this.#identity);
      const ttl = serializeManifest(manifest);
      try {
        await this.#podClient.write(manifestUri, ttl, {
          contentType:    'text/turtle',
          conflictPolicy: 'reject',
        });
        return manifest;
      } catch (err) {
        if (err?.code === 'CONFLICT') {
          lastErr = err;
          continue;
        }
        throw err;
      }
    }
    throw lastErr ?? Object.assign(new Error('IdentityPodStore: manifest retry budget exhausted'), {
      code: 'CONFLICT',
    });
  }
}
