/**
 * ONE STRICT RULE FOR A VALID Ed25519 SIGNATURE — the same answer on every device, whatever library does the curve.
 *
 * Ed25519 libraries disagree on crafted signatures. Measured 2026-11-12 on the 12 published edge-case vectors
 * (ed25519-speccheck, "Taming the many EdDSAs", Chalkias, Garillot, Nikolaenko 2020): tweetnacl (what every device ran
 * until now) accepts a signature whose scalar S is not below the group order L and accepts the identity point as a
 * public key (under which any bytes "verify"); node:crypto and WebCrypto refuse the first and accept the second;
 * libsodium refuses both. If devices checked with different libraries, a member could craft a statement some devices
 * accept and others refuse, and their rosters would differ.
 *
 * So every check passes these BYTE checks first (the ones libsodium makes), and only then the library's own
 * single-signature equation, which must be the cofactorless one (all of ours are):
 *   1. the signature is 64 bytes and the key 32;
 *   2. S (the signature's second half, little-endian) is canonical: S < L;
 *   3. the key A and the point R (the signature's first half) are canonically encoded: y < p;
 *   4. neither A nor R is of small order: its encoding (sign bit ignored) is not one of the seven encodings of the
 *      eight small-order points (two of them non-canonical, kept so the list stands on its own).
 * Pure byte comparisons: no curve arithmetic, so the rule costs nothing next to the check it guards.
 *
 * The seven constants and the rule are pinned against an independent big-integer oracle and the 12 vectors in
 * `test/ed25519Strict.test.js`; honest signatures from today's signer all pass. Every Ed25519 check in the platform
 * goes through `verifyEd25519Strict` (a guard refuses a direct `nacl.sign.detached.verify` elsewhere).
 */
import nacl from 'tweetnacl';

/** The rule set's name, for anything that ever records a verdict beyond this process. */
export const ED25519_RULE = 'ed25519-strict-1';

// L = 2^252 + 27742317777372353535851937790883648493, little-endian
const L_LE = Uint8Array.from([
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10,
]);

const ff = (n) => new Array(n).fill(0xff);
// The encodings (sign bit ignored: the last byte is compared as & 0x7f) of the eight small-order points, as libsodium
// lists them. Order 4 (y = 0), order 1 (y = 1), the two y of order 8, order 2 (y = p - 1), and the non-canonical
// p (= 0) and p + 1 (= 1).
const SMALL_ORDER = [
  new Array(32).fill(0x00),
  [0x01, ...new Array(31).fill(0x00)],
  [0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0,
    0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05],
  [0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f,
    0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a],
  [0xec, ...ff(30), 0x7f],
  [0xed, ...ff(30), 0x7f],
  [0xee, ...ff(30), 0x7f],
].map((a) => Uint8Array.from(a));

/** S < L, comparing little-endian from the most significant byte down. */
function scalarIsCanonical(s) {
  for (let i = 31; i >= 0; i -= 1) {
    if (s[i] < L_LE[i]) return true;
    if (s[i] > L_LE[i]) return false;
  }
  return false;   // S == L
}

/** y < p = 2^255 - 19 (the sign bit is not part of y): non-canonical only for y in [p, 2^255 - 1]. */
function pointIsCanonical(e) {
  if ((e[31] & 0x7f) !== 0x7f) return true;
  for (let i = 30; i >= 1; i -= 1) if (e[i] !== 0xff) return true;
  return e[0] < 0xed;
}

/** One of the small-order encodings, the sign bit ignored. */
function hasSmallOrder(e) {
  for (const bad of SMALL_ORDER) {
    let same = true;
    for (let i = 0; i < 31 && same; i += 1) if (e[i] !== bad[i]) same = false;
    if (same && (e[31] & 0x7f) === bad[31]) return true;
  }
  return false;
}

/**
 * The byte rule alone (no equation): may this (signature, key) pair be handed to a library at all?
 * @param {Uint8Array} sig  64 bytes
 * @param {Uint8Array} key  32 bytes
 */
export function strictSignatureShapeOk(sig, key) {
  if (!(sig instanceof Uint8Array) || !(key instanceof Uint8Array)) return false;
  if (sig.length !== 64 || key.length !== 32) return false;
  const R = sig.subarray(0, 32);
  const S = sig.subarray(32, 64);
  if (!scalarIsCanonical(S)) return false;
  if (!pointIsCanonical(key) || !pointIsCanonical(R)) return false;
  if (hasSmallOrder(key) || hasSmallOrder(R)) return false;
  return true;
}

/**
 * THE check: the strict byte rule, then tweetnacl's cofactorless equation.
 * @param {Uint8Array} msg
 * @param {Uint8Array} sig
 * @param {Uint8Array} key
 * @returns {boolean}
 */
export function verifyEd25519Strict(msg, sig, key) {
  if (!strictSignatureShapeOk(sig, key)) return false;
  try { return nacl.sign.detached.verify(msg, sig, key) === true; } catch { return false; }
}
