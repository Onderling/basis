// hashHex.js — a synchronous, cross-platform (web / RN / node) SHA-256 hex digest.
//
// The kernel's one deterministic string→hash primitive for logic that must be computed
// identically on every device (e.g. the governance caretaker's succession order). Uses the
// same @noble/hashes the identity spine already depends on, so callers reach a kernel
// primitive instead of importing a raw crypto lib into an app (invariant 5 + avoids the
// monorepo hoisting trap where an undeclared transitive dep fails on Metro/EAS).
import { sha256 } from '@noble/hashes/sha2.js';
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
