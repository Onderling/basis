/**
 * signatureMemo — remember that a signature CHECKED OUT, so the same signed bytes are not verified again and again.
 *
 * Verify-on-read re-checks every stored statement on every read, and a roster re-checks every member's link on every
 * derivation. Pure-JS ed25519 makes that the bulk of a busy device's CPU — measured: most of a walk's busy time, which
 * starved everything else on the event loop (a relay's challenge answered tens of seconds late).
 *
 * THE RULE, and the only thing this caches:
 *   • the pure cryptographic check — (the exact signed bytes, the signature, the public key) → true. Nothing else:
 *     never a binding, an authority, a retirement or a revocation decision; those change over time and stay decided
 *     on every read by their callers.
 *   • keyed by the CONTENT itself, never by a hash the content claims — a statement tampered after it was memoised
 *     is a different key, misses, and is verified (and refused);
 *   • a miss or a false is never stored;
 *   • bounded: least recently used out first.
 */
import { AgentIdentity } from '../identity/AgentIdentity.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

const SIGNATURE_MEMO_MAX = param({ key: 'security.signatureMemoMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4096 });

/**
 * Build a memo over the pure signature check: `verify(msg, sig, pubKey)` answers like `AgentIdentity.verify`, but a
 * check that passed once for exactly those bytes, that signature and that key is answered from memory.
 * @param {object} [o]
 * @param {number} [o.max]                                  most remembered checks
 * @param {(msg: string, sig: string, pubKey: string) => boolean} [o.verify]  the real check (default AgentIdentity.verify)
 * @returns {{ verify: (msg: string, sig: string, pubKey: string) => boolean, readonly size: number }}
 */
export function createSignatureMemo({ max = SIGNATURE_MEMO_MAX, verify = (m, s, k) => AgentIdentity.verify(m, s, k) } = {}) {
  const ok = new Map();
  return {
    verify(msg, sig, pubKey) {
      if (typeof msg !== 'string' || typeof sig !== 'string' || typeof pubKey !== 'string') return verify(msg, sig, pubKey);
      const key = `${pubKey}\u0000${sig}\u0000${msg}`;
      if (ok.has(key)) { ok.delete(key); ok.set(key, true); return true; }
      const good = verify(msg, sig, pubKey) === true;
      if (good) {
        ok.set(key, true);
        while (ok.size > max) ok.delete(ok.keys().next().value);
      }
      return good;
    },
    get size() { return ok.size; },
  };
}
