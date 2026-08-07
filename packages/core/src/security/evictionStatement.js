/**
 * evictionStatement.js — sign/verify a member EVICTION as a signed, CHAINED, replayable spine statement.
 *
 * WHY (principles): eviction is enforced by THE CIRCLE, not by one admin's device (P2 no central arbiter, P6
 * membership is proof-derived not a mutable admin table, P10 agreed things computed identically everywhere).
 * So an eviction travels as a statement any peer can VERIFY (the signature proves an authority issued it) and
 * APPLY identically (fold it into the roster), rather than a mutation only the admin's device knows about.
 *
 * SHAPE (v2 — rides the shared per-author chain). An eviction is one entry on the issuer's SPINE chain
 * (proposals · votes · roles · membership · keys — the events where equivocation is an attack), so it carries
 * the `authorChain` fields and a signature:
 *   content = { v, kind:'eviction', circleId, evicted }       // the identity of the eviction
 *   body    = chainEvent(content, { author, parentHash })      // + author · parentHash · hash  (authorChain)
 *   sig     = b64( Ed25519.sign(canonicalize(body)) )          // by the circle-scoped key = author
 *
 *   • `author` is the issuer's CIRCLE-SCOPED signing key (NOT their global identity) — so the statement matches
 *     the roster and preserves per-circle unlinkability (P5). The caller passes the circle-scoped signer.
 *   • `parentHash` is the issuer's PREVIOUS spine-entry hash (null for their first) — the per-author causal
 *     POSITION. This replaces v1's wall-clock `at`: ordering is causal, never a clock (so a clock-skewed device
 *     computes the SAME order, P10). Two evictions by one author off the SAME parent with different content
 *     hash differently → a detectable fork (the `authorChain` fork-proof), which the roster fold resolves.
 *
 * DURABLE + REPLAYABLE: no freshness window — a peer offline for a week must still apply it. Idempotent: the
 * chain `hash` is a stable id, so applying the same signed eviction twice is a no-op.
 *
 * NOT decided here — WHO may evict, and WHETHER a concurrent demotion voids it. `verifyEviction` proves the
 * statement is a genuine, untampered, chain-consistent signature by `body.author`; whether that author is an
 * admin of `body.circleId` at the relevant causal position is the AUTHORITY check the roster FOLD makes
 * (deny-wins from the revoker's view). The crypto proves origin + ordering; the fold decides authority.
 */
import { AgentIdentity }       from '../identity/AgentIdentity.js';
import { canonicalize }        from '../Envelope.js';
import { encode as b64encode } from '../crypto/b64.js';
import { createAuthorChain }   from './authorChain.js';

/**
 * Version of the signed eviction body — a self-describing, namespaced STRING so an independent implementation
 * knows the exact shape without our source (see docs/conventions/signed-bodies.md). `signEviction` writes it;
 * `verifyEviction` rejects any other. v2 = the chained spine shape (v1 was the standalone wall-clock form).
 */
export const EVICTION_STMT_VERSION = 'onderling/eviction.v2';

/**
 * The CONTENT fields that define an eviction's identity — content-selective by construction: it lists ONLY
 * the semantic fields and never the chain fields (`author`/`parentHash`/`hash`), so `chainEvent`'s chain-time
 * hashing and the verifier's recompute agree (the `authorChain` contract). See authorChain.js.
 */
const EVICTION_CONTENT = ['v', 'kind', 'circleId', 'evicted'];
const evictionSerialize = (e) => EVICTION_CONTENT.filter((k) => e[k] !== undefined).map((k) => `${k}=${e[k]}`).join('&');
const evictionChain = createAuthorChain(evictionSerialize);

/**
 * Sign an eviction as a chained spine statement. `identity` is the issuer's CIRCLE-SCOPED signer (its pubKey
 * becomes `body.author`, the chain author).
 *
 * @param {{ pubKey: string, sign: (bytes: Uint8Array) => Uint8Array }} identity  the circle-scoped signer
 * @param {object} args
 * @param {string} args.circleId  the circle the eviction applies to
 * @param {string} args.evicted   the evicted member (circle-scoped id — never a global webid, per P5)
 * @param {string|null} [args.parent]  the issuer's previous spine-entry hash (null for their first). The
 *                                      per-author causal position — supplied by the roster fold at the call site.
 * @returns {{ body: object, sig: string, by: string }}  the statement to fan to peers
 */
export function signEviction(identity, { circleId, evicted, parent = null } = {}) {
  if (!identity?.pubKey) throw new Error('signEviction: circle-scoped authority identity required');
  if (typeof circleId !== 'string' || !circleId) throw new Error('signEviction: circleId required');
  if (typeof evicted  !== 'string' || !evicted)  throw new Error('signEviction: evicted required');
  if (parent !== null && (typeof parent !== 'string' || !parent)) throw new Error('signEviction: parent must be a hash string or null');
  const content = { v: EVICTION_STMT_VERSION, kind: 'eviction', circleId, evicted };
  const body    = evictionChain.chainEvent(content, { author: identity.pubKey, parentHash: parent });
  const sig     = b64encode(identity.sign(canonicalize(body)));
  return { body, sig, by: identity.pubKey };
}

/**
 * Verify an eviction statement is a genuine, untampered, chain-consistent signature by `body.author`. NO
 * timestamp window (durable/replayable). Does NOT decide whether `body.author` may evict, nor whether a
 * concurrent demotion voids it — that is the roster fold's authority-at-time decision (deny-wins).
 *
 * @param {{ body: object, sig: string, by?: string }} statement
 * @param {object} [opts]
 * @param {string} [opts.expectedCircleId]  if given, `body.circleId` must match
 * @returns {{ ok: true, body: object } | { ok: false, reason: string }}
 */
export function verifyEviction(statement, opts = {}) {
  const { expectedCircleId } = opts;
  if (!statement || typeof statement !== 'object') return { ok: false, reason: 'malformed statement' };
  const { body, sig } = statement;
  if (typeof sig !== 'string' || !sig)   return { ok: false, reason: 'missing signature' };
  if (!body || typeof body !== 'object') return { ok: false, reason: 'missing body' };
  if (body.v !== EVICTION_STMT_VERSION)  return { ok: false, reason: `unsupported version: ${body.v}` };
  if (body.kind !== 'eviction')          return { ok: false, reason: 'not an eviction statement' };
  if (typeof body.circleId !== 'string' || !body.circleId) return { ok: false, reason: 'body.circleId required' };
  if (typeof body.evicted  !== 'string' || !body.evicted)  return { ok: false, reason: 'body.evicted required' };
  if (typeof body.author   !== 'string' || !body.author)   return { ok: false, reason: 'body.author required' };
  if (body.parentHash !== null && typeof body.parentHash !== 'string') return { ok: false, reason: 'body.parentHash must be a hash string or null' };
  if (typeof body.hash !== 'string' || !body.hash)         return { ok: false, reason: 'body.hash required' };
  if (expectedCircleId && body.circleId !== expectedCircleId) {
    return { ok: false, reason: 'circle mismatch' };
  }
  // Chain integrity: the hash must recompute from the content + author + parentHash. A tampered content field
  // (a different evicted member) or a rewritten parent no longer hashes the same.
  const recomputed = evictionChain.chainEvent(
    { v: body.v, kind: body.kind, circleId: body.circleId, evicted: body.evicted },
    { author: body.author, parentHash: body.parentHash },
  );
  if (recomputed.hash !== body.hash) return { ok: false, reason: 'bad chain hash' };
  // The signature must verify against the CLAIMED author (the circle-scoped key) over the exact body — so any
  // tampered field (a different evicted member, a forged author) breaks it.
  if (!AgentIdentity.verify(canonicalize(body), sig, body.author)) {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true, body };
}
