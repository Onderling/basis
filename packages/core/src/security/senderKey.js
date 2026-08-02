/**
 * The signing key an envelope CARRIES — and the one place that decides what form it takes.
 *
 * ── Why an envelope carries a key at all (Decision 1, 2026-07-31) ────────────────────────────────
 * The receive path used to read `_from`, look up the key held for that address, and verify the
 * signature against it. `_from` is a plain wire field no transport authenticates, so whoever
 * controlled `_from` chose which key got checked — the cryptography was sound and the one input
 * deciding WHOSE key was being verified was attacker-chosen.
 *
 * Inverted, the envelope carries the key that signed it. Verification becomes self-consistent:
 * nothing is looked up, so nothing can be steered. That buys no trust on its own — a self-signed
 * envelope only ever proves "the holder of key K sent this" — and it is not supposed to. The trust
 * lives one step later, in the roster authorization (`senderAuthorization.js`).
 *
 * ── THIS FILE IS THE L1 SEAM (`plans/DESIGN-boundary-authentication.md` §13.1 — Frits' call) ─────
 * *"Does the envelope carry a full key or a key id? Size on every envelope, against an extra
 * resolution step (and a decision about what to do when the id resolves to nothing)."*
 *
 * Built as the FULL-KEY form, which is the simpler one and the one §7 assumes. The choice is
 * isolated to the two functions below, and nothing outside this file knows which form is on the
 * wire — callers say "what do I put on the envelope" and "what key do I verify against".
 *
 * **If the answer becomes KEY ID**, the whole change is here:
 *   1. `senderCredential()` returns the id (e.g. a truncated hash of the key) instead of the key;
 *   2. `resolveSenderKey()` consults its `lookup` argument instead of returning the credential —
 *      the argument already exists and is already threaded from `SecurityLayer`, precisely so that
 *      answer needs no new plumbing;
 *   3. `resolveSenderKey()` returns `null` when the id resolves to nothing, which every caller
 *      already treats as `MISSING_SENDER_KEY` — so "what to do when it resolves to nothing" is
 *      already answered, and answered fail-closed.
 * The field name does not change and neither does the shape of the receive path.
 *
 * ── A third option worth recording, because it is NOT free ──────────────────────────────────────
 * Under the one-derivation assumption (L2) a per-circle address IS its signing key, so for circle
 * traffic `_signedBy` and `_from` are the same string and the field is redundant *today*. Deriving
 * the key from `_from` instead would save the bytes — but it would tie every transport's address
 * namespace to the key namespace, which is false for the canonical identity on a mesh transport (an
 * mDNS/NKN address is not a pubkey) and would silently break the day L2 is answered "two
 * derivations". The redundancy is deliberate: it is what makes the two questions separable.
 */

/**
 * The envelope header field that carries the credential.
 *
 * Named for what it says rather than for its type, so it stays honest under either L1 answer: a key
 * id still says "signed by". Listed in the relay's routing-header allow-list
 * (`packages/relay/src/verbose.js`) and in the privacy harness
 * (`packages/relay/test/security/whatTheRelayMayLearn.js`), both of which fail if it appears
 * without being declared.
 */
export const SENDER_KEY_FIELD = '_signedBy';

/** An Ed25519 public key is 32 bytes; base64url without padding is 43 characters. */
const ED25519_PUBKEY_B64_LENGTH = 43;

/**
 * What an outbound envelope must carry so a receiver can verify it without looking anything up.
 *
 * @param {{pubKey: string}} identity  the identity that is about to sign
 * @returns {string|null} the credential to stamp on the envelope, or null if there is nothing to say
 */
export function senderCredential(identity) {
  const pubKey = identity?.pubKey;
  if (typeof pubKey !== 'string' || !pubKey) return null;
  return pubKey;   // FULL-KEY FORM — see the header for the key-id form
}

/**
 * Resolve a carried credential to the Ed25519 public key the signature must verify against.
 *
 * Deny-by-default: anything that is not a well-formed key (or, under the key-id form, anything the
 * lookup cannot resolve) returns `null`, and the caller refuses the envelope. A malformed value
 * must never reach `AgentIdentity.verify`, which throws on a wrong-sized key — that would turn a
 * refusable envelope into an exception on the receive path.
 *
 * @param {string} credential           what the envelope carried
 * @param {object} [opts]
 * @param {(id: string) => (string|null)} [opts.lookup]
 *   the key-id resolver. Unused by the full-key form and threaded anyway — it is the seam the
 *   key-id answer plugs into, and a seam nobody passes is a seam nobody wires (Decision 3's lesson).
 * @returns {string|null}
 */
export function resolveSenderKey(credential, { lookup = null } = {}) {
  if (typeof credential !== 'string' || !credential) return null;
  // FULL-KEY FORM: the credential IS the key, and the only question is whether it is a real one.
  if (!isEd25519PubKey(credential)) {
    // Not a key. Under the key-id form this is the ordinary case and the lookup answers it; under
    // the full-key form a lookup is the caller's own business, so consult it rather than assume.
    if (typeof lookup !== 'function') return null;
    let resolved = null;
    try { resolved = lookup(credential); } catch { resolved = null; }
    return (typeof resolved === 'string' && isEd25519PubKey(resolved)) ? resolved : null;
  }
  return credential;
}

/**
 * Is this string a base64url Ed25519 public key?
 *
 * Checked on shape, not by decoding: the decoders in this repo are lenient about padding and
 * alphabet, so a length + alphabet check is the stricter of the two and cannot throw.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isEd25519PubKey(value) {
  return typeof value === 'string'
    && value.length === ED25519_PUBKEY_B64_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Read the credential off an envelope. One accessor so the field name appears in one place.
 * @param {object} envelope
 * @returns {string|null}
 */
export function carriedSenderCredential(envelope) {
  const raw = envelope?.[SENDER_KEY_FIELD];
  return (typeof raw === 'string' && raw) ? raw : null;
}
