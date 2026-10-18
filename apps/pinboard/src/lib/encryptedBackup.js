/**
 * encryptedBackup — passphrase-protected JSON backup
 * (Pinboard V1 Phase 13.6 / 17.2; functional design § I5).
 *
 * **Purpose:** the user generates a `pinboard-backup-<date>.json.enc`
 * encrypted with a passphrase they pick.  Pinboard never sees the
 * file or the passphrase.  The user mails it to themselves, drops
 * it in cloud storage, saves on a USB stick — their choice.
 *
 * Round-trip:
 *   const blob = await encryptBackup({ data, passphrase });
 *   // ...stash blob somewhere safe...
 *   const data = await decryptBackup({ blob, passphrase });
 *
 * Crypto: nacl.secretbox (XSalsa20-Poly1305) — already in core's
 * deps via `tweetnacl`.  Key derivation: PBKDF2-SHA256 with 100k
 * iterations + a fresh 16-byte salt per backup.  Wrapped output
 * is JSON, base64url for binary fields:
 *
 *   {
 *     v: 1,
 *     salt:       <base64url, 16 bytes>,
 *     nonce:      <base64url, 24 bytes>,
 *     ciphertext: <base64url>,
 *     iterations: 100000,
 *     created:    <ms epoch>
 *   }
 *
 * **Substrate candidate (rule of two):** when a second app needs
 * passphrase-protected snapshot export, lift this into a new
 * `@onderling/encrypted-backup` substrate (folio's "take my data"
 * pattern would consume the same shape).  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

import nacl from 'tweetnacl';

// Tiny base64url helpers — Node's Buffer + browser's btoa, padded to
// the unpadded URL-safe variant.  Inlined to avoid pulling core's
// `crypto/b64` (not exported via the package main).
function b64encode(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  const std = (typeof btoa === 'function')
    ? btoa(bin)
    : Buffer.from(bytes).toString('base64');
  return std.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function b64decode(s) {
  const std = s.replaceAll('-', '+').replaceAll('_', '/');
  const pad = std + '='.repeat((4 - std.length % 4) % 4);
  if (typeof atob === 'function') {
    const bin = atob(pad);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(pad, 'base64'));
}

const VERSION = 1;
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const KEY_BYTES = 32;     // nacl.secretbox needs 32 bytes
const NONCE_BYTES = 24;

/**
 * PBKDF2-SHA256 key derivation.  Uses Web Crypto when available
 * (browsers + modern Node); falls back to a synchronous nacl-based
 * stretch if not (development / test).
 */
async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const enc = new TextEncoder();
  const passBytes = enc.encode(passphrase);

  if (typeof globalThis.crypto?.subtle?.importKey === 'function') {
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw', passBytes, { name: 'PBKDF2' }, false, ['deriveBits'],
    );
    const bits = await globalThis.crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
      baseKey,
      KEY_BYTES * 8,
    );
    return new Uint8Array(bits);
  }
  // Fallback: synchronous N-iteration nacl.hash chain.  Slower but
  // works without Web Crypto.  Production code paths should always
  // get the Web Crypto path.
  let block = nacl.hash(_concat(passBytes, salt));
  for (let i = 1; i < Math.max(1000, iterations / 100); i += 1) {
    block = nacl.hash(_concat(block, salt));
  }
  return block.slice(0, KEY_BYTES);
}

function _concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0); out.set(b, a.length);
  return out;
}

/**
 * Encrypt arbitrary serialisable `data` with `passphrase`.
 * Returns a JSON-serialisable blob ready to be saved as a file.
 *
 * @param {object} args
 * @param {any} args.data            anything `JSON.stringify` can encode
 * @param {string} args.passphrase
 * @returns {Promise<object>}
 */
export async function encryptBackup({ data, passphrase }) {
  if (typeof passphrase !== 'string' || passphrase.length === 0) {
    throw new TypeError('encryptBackup: passphrase required');
  }
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const salt  = nacl.randomBytes(SALT_BYTES);
  const nonce = nacl.randomBytes(NONCE_BYTES);
  const key   = await deriveKey(passphrase, salt);
  const cipher = nacl.secretbox(plaintext, nonce, key);
  return {
    v:          VERSION,
    salt:       b64encode(salt),
    nonce:      b64encode(nonce),
    ciphertext: b64encode(cipher),
    iterations: ITERATIONS,
    created:    Date.now(),
  };
}

/**
 * Decrypt a previously-`encryptBackup`-produced blob with a passphrase.
 * Returns the original `data` object, or throws on wrong passphrase /
 * tampered ciphertext.
 *
 * @param {object} args
 * @param {object} args.blob
 * @param {string} args.passphrase
 * @returns {Promise<any>}
 */
export async function decryptBackup({ blob, passphrase }) {
  if (!blob || blob.v !== VERSION) throw new Error('decryptBackup: unsupported blob version');
  const salt   = b64decode(blob.salt);
  const nonce  = b64decode(blob.nonce);
  const cipher = b64decode(blob.ciphertext);
  const key    = await deriveKey(passphrase, salt, blob.iterations ?? ITERATIONS);
  const plaintext = nacl.secretbox.open(cipher, nonce, key);
  if (!plaintext) throw new Error('decryptBackup: wrong passphrase or tampered ciphertext');
  return JSON.parse(new TextDecoder().decode(plaintext));
}
