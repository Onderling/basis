/**
 * originSignature.js — sign/verify helpers for the verified-origin
 * attribution path (Group Z).
 *
 * The origin signs a deterministic canonical form of the *invocation
 * intent*, not the envelope wrapper:
 *
 *   body = { v: 'onderling/origin.v1', target, skill, parts, ts }
 *   sig  = b64url( Ed25519.sign(canonicalize(body), origin.privateKey) )
 *
 * Three fields travel with the RQ payload to the target:
 *   _origin    — the signer's pubkey
 *   _originSig — the signature above
 *   _originTs  — the `ts` used when signing (needed to rebuild the body)
 *
 * Receiver reconstructs `body` with its own pubkey as `target` and
 * verifies via AgentIdentity.verify.  No pre-hashing of `parts`:
 * Ed25519 handles arbitrary input via internal SHA-512.
 *
 * See Design-v3/origin-signature.md.
 */
import { AgentIdentity }       from '../identity/AgentIdentity.js';
import { canonicalize }         from '../Envelope.js';
import { encode as b64encode }  from '../crypto/b64.js';

/**
 * Version (`v` field) of the signed origin-signature body — a self-describing, namespaced STRING so an
 * independent implementation knows the exact shape without our source (docs/conventions/signed-bodies.md).
 * `signOrigin` writes it; `verifyOrigin` rejects any other version.
 */
export const ORIGIN_SIG_VERSION      = 'onderling/origin.v1';
/** Default clock-skew window for verifyOrigin's timestamp check: ±10 minutes. */
import { param, PARAM_SCOPE, PARAM_KIND } from '../params.js';

// Parameter register (#36) — origin-signature freshness window (scope:device, kind:INTERNAL — a security
// bound, immutable by construction; mirrors security.replayWindowMs).
export const DEFAULT_ORIGIN_WINDOW_MS = param({ key: 'originSignature.windowMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 * 60_000 });  // ±10 min, matches SecurityLayer

/**
 * Sign an invocation intent.
 *
 * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity
 * @param {object} body
 * @param {string} body.target  — recipient's pubkey (base64url Ed25519)
 * @param {string} body.skill
 * @param {Array}  body.parts
 * @param {number} [body.ts]    — defaults to Date.now()
 * @returns {{ originTs: number, sig: string }}  the base64url signature
 *          plus the timestamp the caller should ship alongside.
 */
export function signOrigin(identity, { target, skill, parts, ts } = {}) {
  if (!identity?.pubKey) throw new Error('signOrigin: identity required');
  if (typeof target !== 'string' || !target) throw new Error('signOrigin: target required');
  if (typeof skill  !== 'string' || !skill)  throw new Error('signOrigin: skill required');
  if (!Array.isArray(parts))                  throw new Error('signOrigin: parts must be an array');

  const resolvedTs = typeof ts === 'number' ? ts : Date.now();

  const body = {
    v:      ORIGIN_SIG_VERSION,
    target,
    skill,
    parts,
    ts:     resolvedTs,
  };

  const sigBytes = identity.sign(canonicalize(body));
  return { originTs: resolvedTs, sig: b64encode(sigBytes) };
}

/**
 * Verify an origin signature.
 *
 * @param {object} claim
 * @param {string}  claim.origin         — claimed signer pubkey
 * @param {string}  claim.sig            — base64url signature
 * @param {object}  claim.body
 * @param {number}  claim.body.v
 * @param {string}  claim.body.target
 * @param {string}  claim.body.skill
 * @param {Array}   claim.body.parts
 * @param {number}  claim.body.ts
 *
 * @param {object}  opts
 * @param {string}  opts.expectedPubKey  — must match body.target + `claim.origin`'s key
 * @param {number}  [opts.now]            — override for tests; defaults to Date.now()
 * @param {number}  [opts.windowMs]       — allowed clock slack; default ±10 min
 *
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function verifyOrigin(claim, opts = {}) {
  const {
    expectedPubKey,
    now      = Date.now(),
    windowMs = DEFAULT_ORIGIN_WINDOW_MS,
  } = opts;

  if (!claim || typeof claim !== 'object') {
    return { ok: false, reason: 'malformed claim' };
  }
  const { origin, sig, body } = claim;
  if (typeof origin !== 'string' || !origin) return { ok: false, reason: 'missing origin' };
  if (typeof sig    !== 'string' || !sig)    return { ok: false, reason: 'missing signature' };
  if (!body || typeof body !== 'object')     return { ok: false, reason: 'missing body' };

  if (body.v !== ORIGIN_SIG_VERSION) {
    return { ok: false, reason: `unsupported version: ${body.v}` };
  }
  if (typeof body.target !== 'string' || !body.target) {
    return { ok: false, reason: 'body.target required' };
  }
  if (typeof body.skill !== 'string' || !body.skill) {
    return { ok: false, reason: 'body.skill required' };
  }
  if (!Array.isArray(body.parts)) {
    return { ok: false, reason: 'body.parts must be an array' };
  }
  if (typeof body.ts !== 'number' || !Number.isFinite(body.ts)) {
    return { ok: false, reason: 'body.ts must be a finite number' };
  }

  // Reflection guard — body.target must be us.
  if (expectedPubKey && body.target !== expectedPubKey) {
    return { ok: false, reason: 'target mismatch' };
  }

  // Timestamp window.
  if (Math.abs(now - body.ts) > windowMs) {
    return { ok: false, reason: `timestamp outside ±${windowMs}ms window` };
  }

  // Ed25519 signature.
  if (!AgentIdentity.verify(canonicalize(body), sig, origin)) {
    return { ok: false, reason: 'bad signature' };
  }

  return { ok: true };
}
