/**
 * PodExporter — serialize a Solid pod into a portable, optionally
 * encrypted, deterministic archive.  Track C / C3.
 *
 * Archive format (v1, primary): "Solid LDP archive".  Single binary blob
 * with this byte layout:
 *
 *   [8 bytes ] magic = "DWLDP\0v1"
 *   [4 bytes ] header-length (uint32 LE)
 *   [N bytes ] header JSON (UTF-8)
 *   [body    ] entries section — plaintext OR a single ciphertext blob
 *              (when encrypted), produced by `nacl.secretbox`.
 *
 * Entries section layout (plaintext, OR plaintext-before-encryption):
 *
 *   [4 bytes ] path-length (uint32 LE)
 *   [P bytes ] path (UTF-8)
 *   [8 bytes ] content-length (uint64 LE — written as two uint32 LE halves)
 *   [C bytes ] content (binary)
 *   [4 bytes ] contentType-length (uint32 LE)
 *   [T bytes ] contentType (UTF-8)
 *
 * Header JSON shape:
 *
 *   {
 *     v:           1,
 *     format:      'solid-ldp-archive',
 *     podRoot:     'https://alice.example/',
 *     exportedAt:  '<ISO 8601>',
 *     encrypted:   boolean,
 *     encryption?: { alg: 'xsalsa20poly1305', salt: <b64>, nonce: <b64> },
 *     entryCount:  number,
 *     dataOnly:    boolean,
 *   }
 *
 * Determinism: entries are sorted by path before serialization so two
 * exports of an unchanged pod (with `encrypt: false`, or with the same
 * salt/nonce — only useful in tests) produce byte-for-byte equal output.
 *
 * Limitations (v1):
 *   - Zip-with-manifest alternative format is deferred (Q-C.3 lists it as
 *     the alternative; primary is the LDP archive shipped here).
 *   - ACL re-establishment is OUT OF SCOPE; PodImporter writes resource
 *     bytes only.  Solid ACP/WAC handling is a follow-up.
 *   - Content history is not preserved (latest-only, per Track-C plan).
 *
 * TODO(C3-followup): zip alternative + ACL re-establishment.
 */
import nacl from 'tweetnacl';
import { createHash } from 'node:crypto';

// `node:crypto` is eager (previously lazy-loaded for the basis
// vite bundle).  Canopy-chat's vite.config aliases `node:crypto` to a
// browser-safe stub that throws if `createHash` is called — but
// `digest()` (the only caller below) is itself only invoked from Node
// PodExporter flows, never from the browser. See cleanup.

import { Bootstrap } from '@onderling/core';

const MAGIC          = new Uint8Array([0x44, 0x57, 0x4c, 0x44, 0x50, 0x00, 0x76, 0x31]); // "DWLDP\0v1"
const FORMAT_NAME    = 'solid-ldp-archive';
const FORMAT_VERSION = 1;
const ENC_ALG        = 'xsalsa20poly1305';
// ⚠ FROZEN FOREVER — key-derivation info (hashed, invisible); renaming would make existing export
// archives undecryptable. A future format versions to onderling-pod-export-v2.
const ENC_INFO       = 'canopy-pod-export-v1';
const SALT_LEN       = 16;
const NONCE_LEN      = 24;

// Both spellings of the identity container count (naming migration 2026-07-29: new pods use
// /onderling/, pre-rename pods keep /canopy/).
const IDENTITY_CONTAINER_PATHS = ['/onderling/', '/canopy/'];

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ── Internal helpers ────────────────────────────────────────────────────────

function isContainerUri(uri) {
  return typeof uri === 'string' && uri.endsWith('/');
}

function toUint8(content) {
  if (content instanceof Uint8Array) return content;
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  if (typeof content === 'string')    return textEncoder.encode(content);
  // Anything else (e.g. parsed JSON) — re-stringify deterministically.
  return textEncoder.encode(JSON.stringify(content));
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.byteLength; }
  return out;
}

function writeUint32LE(view, offset, n) {
  view.setUint32(offset, n >>> 0, true);
}

function writeUint64LE(view, offset, n) {
  // JS numbers safely represent up to 2^53-1; for archive entries that's
  // far more than enough.  We split the value into low/high 32-bit halves.
  const low  = n >>> 0;
  const high = Math.floor(n / 0x100000000) >>> 0;
  view.setUint32(offset,     low,  true);
  view.setUint32(offset + 4, high, true);
}

function readUint32LE(view, offset) { return view.getUint32(offset, true); }

function readUint64LE(view, offset) {
  const low  = view.getUint32(offset,     true);
  const high = view.getUint32(offset + 4, true);
  return high * 0x100000000 + low;
}

function bytesToBase64(bytes) {
  // Use Buffer in Node, btoa fallback elsewhere.  Core targets Node + RN +
  // browsers; both branches exist in the codebase already (see Mnemonic.js).
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Encode an entry list into the body bytes (pre-encryption).
 *
 * @param {Array<{ path: string, content: Uint8Array, contentType: string }>} entries
 */
function encodeEntries(entries) {
  const chunks = [];
  for (const e of entries) {
    const pathBytes = textEncoder.encode(e.path);
    const ctBytes   = textEncoder.encode(e.contentType || 'application/octet-stream');

    const header = new ArrayBuffer(4);
    writeUint32LE(new DataView(header), 0, pathBytes.length);
    chunks.push(new Uint8Array(header));
    chunks.push(pathBytes);

    const lenBuf = new ArrayBuffer(8);
    writeUint64LE(new DataView(lenBuf), 0, e.content.length);
    chunks.push(new Uint8Array(lenBuf));
    chunks.push(e.content);

    const ctLen = new ArrayBuffer(4);
    writeUint32LE(new DataView(ctLen), 0, ctBytes.length);
    chunks.push(new Uint8Array(ctLen));
    chunks.push(ctBytes);
  }
  return concatBytes(chunks);
}

/**
 * Decode the entries section.  Throws on malformed input.
 */
function decodeEntries(bytes, expectedCount) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = [];
  let off = 0;
  while (off < bytes.length) {
    if (off + 4 > bytes.length) throw new Error('PodExporter: truncated entry (path-length)');
    const pathLen = readUint32LE(view, off); off += 4;
    if (off + pathLen > bytes.length) throw new Error('PodExporter: truncated entry (path)');
    const path = textDecoder.decode(bytes.subarray(off, off + pathLen)); off += pathLen;

    if (off + 8 > bytes.length) throw new Error('PodExporter: truncated entry (content-length)');
    const contentLen = readUint64LE(view, off); off += 8;
    if (off + contentLen > bytes.length) throw new Error('PodExporter: truncated entry (content)');
    const content = bytes.subarray(off, off + contentLen); off += contentLen;

    if (off + 4 > bytes.length) throw new Error('PodExporter: truncated entry (contentType-length)');
    const ctLen = readUint32LE(view, off); off += 4;
    if (off + ctLen > bytes.length) throw new Error('PodExporter: truncated entry (contentType)');
    const contentType = textDecoder.decode(bytes.subarray(off, off + ctLen)); off += ctLen;

    out.push({ path, content: new Uint8Array(content), contentType });
  }
  if (typeof expectedCount === 'number' && out.length !== expectedCount) {
    throw new Error(`PodExporter: entry count mismatch (got ${out.length}, expected ${expectedCount})`);
  }
  return out;
}

/**
 * Frame header + body into the final archive bytes.
 */
function frame(headerJson, body) {
  const headerBytes = textEncoder.encode(JSON.stringify(headerJson));
  const lenBuf      = new ArrayBuffer(4);
  writeUint32LE(new DataView(lenBuf), 0, headerBytes.length);
  return concatBytes([MAGIC, new Uint8Array(lenBuf), headerBytes, body]);
}

/**
 * Parse a framed archive into { header, body } where `body` is still
 * the (possibly encrypted) blob that follows the header JSON.
 */
function unframe(archive) {
  if (!(archive instanceof Uint8Array)) {
    throw new Error('PodExporter: archive must be a Uint8Array');
  }
  if (archive.length < MAGIC.length + 4) {
    throw new Error('PodExporter: archive too short');
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (archive[i] !== MAGIC[i]) throw new Error('PodExporter: bad magic');
  }
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const headerLen = readUint32LE(view, MAGIC.length);
  const headerStart = MAGIC.length + 4;
  const headerEnd   = headerStart + headerLen;
  if (headerEnd > archive.length) throw new Error('PodExporter: truncated header');
  const headerJson = JSON.parse(textDecoder.decode(archive.subarray(headerStart, headerEnd)));
  if (headerJson.v !== FORMAT_VERSION || headerJson.format !== FORMAT_NAME) {
    throw new Error(`PodExporter: unsupported archive format ${headerJson.format}@${headerJson.v}`);
  }
  const body = archive.subarray(headerEnd);
  return { header: headerJson, body };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Serialize a Solid pod into a portable archive.  Encrypted by default
 * when a `bootstrap` is provided.
 *
 * Construction:
 *
 *   const exporter = new PodExporter({ podClient, podRoot, bootstrap });
 *   const archive  = await exporter.export({ encrypt: true, dataOnly: false });
 */
export class PodExporter {
  /** @type {object} */ #podClient;
  /** @type {string} */ #podRoot;
  /** @type {Bootstrap | null} */ #bootstrap;

  /**
   * @param {object}        opts
   * @param {object}        opts.podClient   — `PodClient` instance.
   * @param {string}        opts.podRoot     — pod root URI (trailing slash).
   * @param {Bootstrap}    [opts.bootstrap]  — required when `encrypt: true`.
   */
  constructor({ podClient, podRoot, bootstrap = null } = {}) {
    if (!podClient || typeof podClient.list !== 'function' || typeof podClient.read !== 'function') {
      throw new Error('PodExporter: podClient with .list/.read is required');
    }
    if (typeof podRoot !== 'string' || podRoot.length === 0) {
      throw new Error('PodExporter: podRoot is required');
    }
    if (bootstrap !== null && !(bootstrap instanceof Bootstrap)) {
      throw new Error('PodExporter: bootstrap must be a Bootstrap instance');
    }
    this.#podClient = podClient;
    this.#podRoot   = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.#bootstrap = bootstrap;
  }

  /**
   * Walk the pod, serialize all resources into an in-memory archive.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.encrypt=true]
   * @param {boolean} [opts.dataOnly=false]
   * @param {string}  [opts.startContainer]  defaults to the pod root.
   * @param {Uint8Array} [opts.salt]   — test-only: deterministic salt.
   * @param {Uint8Array} [opts.nonce]  — test-only: deterministic nonce.
   * @returns {Promise<Uint8Array>}
   */
  async export(opts = {}) {
    const encrypt   = opts.encrypt   !== false;          // default true
    const dataOnly  = opts.dataOnly  === true;
    const startContainer = opts.startContainer || this.#podRoot;

    if (encrypt && !this.#bootstrap) {
      throw new Error('PodExporter.export: encrypt=true requires a Bootstrap');
    }

    const entries = await this.#walk(startContainer, dataOnly);
    // Determinism: stable sort by path.
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const entriesBytes = encodeEntries(entries);

    const header = {
      v:          FORMAT_VERSION,
      format:     FORMAT_NAME,
      podRoot:    this.#podRoot,
      exportedAt: opts.exportedAt || new Date().toISOString(),
      encrypted:  encrypt,
      entryCount: entries.length,
      dataOnly,
    };

    if (!encrypt) {
      return frame(header, entriesBytes);
    }

    const salt  = opts.salt  || nacl.randomBytes(SALT_LEN);
    const nonce = opts.nonce || nacl.randomBytes(NONCE_LEN);
    const key   = this.#bootstrap.deriveResourceKey(ENC_INFO, salt);
    const ct    = nacl.secretbox(entriesBytes, nonce, key);

    header.encryption = {
      alg:   ENC_ALG,
      salt:  bytesToBase64(salt),
      nonce: bytesToBase64(nonce),
    };
    return frame(header, ct);
  }

  /**
   * SHA-256 digest of the archive bytes — useful for "did anything change
   * since my last backup?".  Re-runs `export()` with the same options.
   *
   * Note: when `encrypt: true` with a fresh random salt/nonce, two digests
   * of an unchanged pod will differ.  Pass `opts.salt` and `opts.nonce`
   * (or `encrypt: false`) for a stable digest.
   *
   * @param   {object} [opts]   forwarded to `export()`.
   * @returns {Promise<string>} hex SHA-256 digest.
   */
  async digest(opts = {}) {
    const archive = await this.export(opts);
    return createHash('sha256').update(archive).digest('hex');
  }

  // ── Internal walk ─────────────────────────────────────────────────────────

  async #walk(containerUri, dataOnly) {
    const out = [];
    const visited = new Set();
    const queue = [containerUri];

    while (queue.length) {
      const c = queue.shift();
      if (visited.has(c)) continue;
      visited.add(c);

      let listing;
      try {
        listing = await this.#podClient.list(c, { recursive: false });
      } catch (err) {
        // Skip containers we can't list — track but don't fatal-fail.
        // Surfacing per-resource errors is a follow-up.
        continue;
      }

      const entries = Array.isArray(listing?.entries) ? listing.entries : [];
      for (const ent of entries) {
        if (!ent?.uri) continue;

        // dataOnly: skip the identity container and anything beneath it.
        if (dataOnly && this.#isIdentityPath(ent.uri)) continue;

        if (ent.type === 'container' || isContainerUri(ent.uri)) {
          queue.push(ent.uri);
          continue;
        }

        // Resource — fetch bytes.
        let res;
        try {
          // Force binary decode to keep arbitrary content types lossless.
          res = await this.#podClient.read(ent.uri, { decode: 'binary' });
        } catch (err) {
          continue;  // skip unreadable resources
        }

        const path = this.#relativePath(ent.uri);
        out.push({
          path,
          content:     toUint8(res.content),
          contentType: res.contentType || ent.contentType || 'application/octet-stream',
        });
      }
    }
    return out;
  }

  #isIdentityPath(uri) {
    if (typeof uri !== 'string') return false;
    if (!uri.startsWith(this.#podRoot)) return false;
    const rel = '/' + uri.slice(this.#podRoot.length);
    return IDENTITY_CONTAINER_PATHS.some((p) => rel === p || rel.startsWith(p));
  }

  #relativePath(uri) {
    if (typeof uri !== 'string') return uri;
    if (uri.startsWith(this.#podRoot)) {
      return '/' + uri.slice(this.#podRoot.length);
    }
    return uri;
  }
}

// Re-export the framing primitives so PodImporter can reuse them without
// rebuilding parsers from scratch.
export const __archive = {
  MAGIC,
  FORMAT_NAME,
  FORMAT_VERSION,
  ENC_ALG,
  ENC_INFO,
  SALT_LEN,
  NONCE_LEN,
  encodeEntries,
  decodeEntries,
  frame,
  unframe,
  bytesToBase64,
  base64ToBytes,
  toUint8,
};
