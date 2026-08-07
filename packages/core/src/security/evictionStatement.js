/**
 * evictionStatement.js — sign/verify a member EVICTION as a signed, replayable statement.
 *
 * WHY (principles): eviction is enforced by THE CIRCLE, not by one admin's device (P2 no central arbiter, P6
 * membership is proof-derived not a mutable admin table, P10 agreed things computed identically everywhere).
 * So an eviction travels as a statement any peer can VERIFY (the signature proves an authority issued it) and
 * APPLY identically (fold it into the local eviction roster), rather than a mutation only the admin's device
 * knows about.
 *
 * The authority signs a deterministic canonical body:
 *   body = { v, kind:'eviction', circleId, evicted, by, at }
 *   sig  = b64url( Ed25519.sign(canonicalize(body)) )
 *
 * DURABLE + REPLAYABLE (the key difference from `originSignature.js`, which is anti-replay with a ±10min
 * window): an eviction has NO freshness window — a peer that receives it late (offline for a week) must still
 * apply it. `at` is for ORDERING (an eviction supersedes an earlier readmission and vice-versa, resolved by
 * the caller), never a validity gate. Idempotent: applying the same signed eviction twice is a no-op.
 *
 * NOT decided here — WHO may evict. `verifyEviction` proves the statement is a genuine, untampered signature by
 * `body.by`; whether `body.by` is an ADMIN of `body.circleId` is an authority check the CALLER makes against
 * its roster (the roster is the caller's, not the substrate's). Same split as the roster-authority checks
 * elsewhere: the crypto proves origin, the policy decides authority.
 */
import { AgentIdentity }       from '../identity/AgentIdentity.js';
import { canonicalize }        from '../Envelope.js';
import { encode as b64encode } from '../crypto/b64.js';

/**
 * Version of the signed eviction body — a self-describing, namespaced STRING so an independent implementation
 * knows the exact shape without our source (see docs/conventions/signed-bodies.md). `signEviction` writes it;
 * `verifyEviction` rejects any other.
 */
export const EVICTION_STMT_VERSION = 'onderling/eviction.v1';

/** The canonical body an eviction statement signs — the single source both signer and verifier rebuild. */
function evictionBody({ circleId, evicted, by, at }) {
  return { v: EVICTION_STMT_VERSION, kind: 'eviction', circleId, evicted, by, at };
}

/**
 * Sign an eviction. The `identity` is the evicting AUTHORITY's key (its pubKey becomes `body.by`).
 *
 * @param {import('../identity/AgentIdentity.js').AgentIdentity} identity  the authority's identity
 * @param {object} args
 * @param {string} args.circleId  the circle the eviction applies to
 * @param {string} args.evicted   the evicted member (webid / pubkey)
 * @param {number} [args.at]       epoch ms (defaults to Date.now(); pass explicitly in tests)
 * @returns {{ body: object, sig: string, by: string }}  the statement to fan to peers
 */
export function signEviction(identity, { circleId, evicted, at } = {}) {
  if (!identity?.pubKey) throw new Error('signEviction: authority identity required');
  if (typeof circleId !== 'string' || !circleId) throw new Error('signEviction: circleId required');
  if (typeof evicted  !== 'string' || !evicted)  throw new Error('signEviction: evicted required');
  const resolvedAt = typeof at === 'number' ? at : Date.now();
  const body = evictionBody({ circleId, evicted, by: identity.pubKey, at: resolvedAt });
  const sig = b64encode(identity.sign(canonicalize(body)));
  return { body, sig, by: identity.pubKey };
}

/**
 * Verify an eviction statement is a genuine, untampered signature by `body.by`. NO timestamp window — an
 * eviction is durable/replayable. Does NOT decide whether `body.by` may evict (the caller's authority check).
 *
 * @param {{ body: object, sig: string, by?: string }} statement
 * @param {object} [opts]
 * @param {string} [opts.expectedCircleId]  if given, `body.circleId` must match (a statement for another
 *                                          circle is not ours to apply)
 * @returns {{ ok: true, body: object } | { ok: false, reason: string }}
 */
export function verifyEviction(statement, opts = {}) {
  const { expectedCircleId } = opts;
  if (!statement || typeof statement !== 'object') return { ok: false, reason: 'malformed statement' };
  const { body, sig } = statement;
  if (typeof sig !== 'string' || !sig)  return { ok: false, reason: 'missing signature' };
  if (!body || typeof body !== 'object') return { ok: false, reason: 'missing body' };
  if (body.v !== EVICTION_STMT_VERSION)  return { ok: false, reason: `unsupported version: ${body.v}` };
  if (body.kind !== 'eviction')          return { ok: false, reason: 'not an eviction statement' };
  if (typeof body.circleId !== 'string' || !body.circleId) return { ok: false, reason: 'body.circleId required' };
  if (typeof body.evicted  !== 'string' || !body.evicted)  return { ok: false, reason: 'body.evicted required' };
  if (typeof body.by       !== 'string' || !body.by)       return { ok: false, reason: 'body.by required' };
  if (typeof body.at !== 'number' || !Number.isFinite(body.at)) return { ok: false, reason: 'body.at must be finite' };
  if (expectedCircleId && body.circleId !== expectedCircleId) {
    return { ok: false, reason: 'circle mismatch' };
  }
  // The signature must verify against the CLAIMED signer (body.by) — over the exact canonical body, so any
  // tampered field (a different evicted member, a different circle) breaks it.
  if (!AgentIdentity.verify(canonicalize(body), sig, body.by)) {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true, body };
}
