// hashHex.js — a synchronous, cross-platform (web / RN / node) SHA-256 hex digest.
//
// The kernel's one deterministic string→hash primitive for logic that must be computed
// identically on every device (e.g. the governance caretaker's succession order). Uses the
// same @noble/hashes the identity spine already depends on, so callers reach a kernel
// primitive instead of importing a raw crypto lib into an app (invariant 5 + avoids the
// monorepo hoisting trap where an undeclared transitive dep fails on Metro/EAS).
import { sha256 } from '@noble/hashes/sha2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { bytesToHex } from '@noble/hashes/utils.js';

const _enc = new TextEncoder();

/**
 * SHA-256 of a UTF-8 string (or bytes), as lowercase hex. Deterministic and identical on
 * every platform — safe to use where independent replicas must agree without coordinating.
 * @param {string|Uint8Array} input
 * @returns {string} 64-char lowercase hex
 */
export function hashHex(input) {
  const bytes = typeof input === 'string' ? _enc.encode(input) : input;
  return bytesToHex(sha256(bytes));
}

/**
 * HMAC-SHA-256 of a UTF-8 message under a UTF-8 key, as base64url without padding (no "/" or "+": safe in a request
 * field that refuses them, as Privatemode's cache salt does). Same bytes on every platform. A secret derived per purpose:
 * the caller puts the purpose in the message (`prompt-cache:<conversation>`).
 * @param {string} key
 * @param {string} message
 * @returns {string} 43 characters
 */
export function hmacBase64Url(key, message) {
  const mac = hmac(sha256, _enc.encode(String(key)), _enc.encode(String(message)));
  // base64url by hand: no `btoa` (not on every JS engine a phone runs)
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  for (let i = 0; i < mac.length; i += 3) {
    const n = (mac[i] << 16) | ((mac[i + 1] ?? 0) << 8) | (mac[i + 2] ?? 0);
    out += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < mac.length ? A[(n >> 6) & 63] : '') + (i + 2 < mac.length ? A[n & 63] : '');
  }
  return out;
}
