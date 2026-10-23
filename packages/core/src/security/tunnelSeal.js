/**
 * tunnelSeal — symmetric AEAD for in-tunnel OWs (Group CC3b).
 *
 * Uses `nacl.secretbox` (XSalsa20-Poly1305) with a 32-byte session key K
 * negotiated out-of-band inside the sealed tunnel-open RQ (packSealed
 * extras carry `tunnelKey` + `aliceTaskId`).  Every in-tunnel OW is
 * encrypted once by the sender with K, routed opaquely through Bob the
 * bridge, and decrypted by the receiver.
 *
 * Why symmetric per-session vs. per-OW packSealed (ECDH+XSalsa):
 *   • ~100× cheaper per message on phones (≈10 μs vs ≈1 ms).
 *   • No public-key key agreement on the hot path — important for
 *     streaming handlers that may emit thousands of chunks.
 *   • Forward-secrecy tradeoff is documented in
 *     Design-v3/hop-tunnel.md § 7: tunnels are short-lived (10 min TTL);
 *     a future `tunnel-rekey` OW can rotate K if compromise matters.
 *
 * Wire shape (opaque to Bob):
 *   { sealed: <base64url secretbox ciphertext>,
 *     nonce:  <base64url 24-byte nonce> }
 *
 * Plaintext inside the seal is the JSON-serialised `innerOW` object —
 * anything the caller wants to ship through the tunnel.  Typical shapes:
 *   { type: 'stream-chunk',  parts: [...] }
 *   { type: 'stream-end',    parts: [...] }
 *   { type: 'input-required', parts: [...] }
 *   { type: 'task-input',    parts: [...] }
 *   { type: 'cancel' }
 *   { type: 'tunnel-result', status: 'completed', parts: [...] }
 */
import nacl                                         from 'tweetnacl';
import { encode as b64encode, decode as b64decode } from '../crypto/b64.js';
import { parseUntrustedJson } from './untrustedJson.js';

/**
 * Generate a fresh 32-byte session key.  Caller stores it locally and
 * ships it to the far end inside the sealed tunnel-open RQ.
 *
 * @returns {string} base64url-encoded 32 bytes
 */
export function generateTunnelKey() {
  return b64encode(nacl.randomBytes(nacl.secretbox.keyLength));
}

/**
 * Seal an inner-OW plaintext object with the session key K.
 *
 * @param {object} opts
 * @param {string} opts.key         base64url-encoded 32-byte key
 * @param {object} opts.innerOW     plaintext JSON object
 * @returns {{ sealed: string, nonce: string }}
 */
export function sealTunnelOW({ key, innerOW } = {}) {
  if (typeof key !== 'string' || !key) throw new Error('sealTunnelOW: key required');
  if (innerOW == null || typeof innerOW !== 'object') {
    throw new Error('sealTunnelOW: innerOW must be an object');
  }
  const keyBytes = b64decode(key);
  if (keyBytes.length !== nacl.secretbox.keyLength) {
    throw new Error(`sealTunnelOW: key must decode to ${nacl.secretbox.keyLength} bytes`);
  }

  const nonce      = nacl.randomBytes(nacl.secretbox.nonceLength);
  const plaintext  = new TextEncoder().encode(JSON.stringify(innerOW));
  const ciphertext = nacl.secretbox(plaintext, nonce, keyBytes);

  return { sealed: b64encode(ciphertext), nonce: b64encode(nonce) };
}

/**
 * Open a sealed inner-OW.  Returns `null` on authentication failure so
 * callers can cleanly drop the message without throwing.
 *
 * @param {object} opts
 * @param {string} opts.key     base64url-encoded 32-byte key
 * @param {string} opts.sealed  base64url secretbox ciphertext
 * @param {string} opts.nonce   base64url 24-byte nonce
 * @returns {object|null}       parsed innerOW, or null on failure
 */
export function openTunnelOW({ key, sealed, nonce } = {}) {
  if (typeof key   !== 'string' || !key)   return null;
  if (typeof sealed !== 'string' || !sealed) return null;
  if (typeof nonce  !== 'string' || !nonce)  return null;

  let keyBytes, cipherBytes, nonceBytes;
  try {
    keyBytes    = b64decode(key);
    cipherBytes = b64decode(sealed);
    nonceBytes  = b64decode(nonce);
  } catch { return null; }

  if (keyBytes.length   !== nacl.secretbox.keyLength)   return null;
  if (nonceBytes.length !== nacl.secretbox.nonceLength) return null;

  const plaintext = nacl.secretbox.open(cipherBytes, nonceBytes, keyBytes);
  if (!plaintext) return null;

  try {
    return parseUntrustedJson(new TextDecoder().decode(plaintext));
  } catch { return null; }
}
