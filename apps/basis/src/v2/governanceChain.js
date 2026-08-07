/**
 * basis v2 — governance hash-chain + fork-proofs (Phase 4 §5, L3).
 *
 * L2 already stops FORGERY (every event signed by the author's per-circle key). L3 stops
 * EQUIVOCATION — a member signing two contradictory things and sending each to a different
 * half of the circle (double-voting, key-splitting). Each governance-spine event carries a
 * `parentHash` pointing at the author's PREVIOUS event, so an honest author has one chain:
 * e1 ← e2 ← e3. To equivocate they must publish two events with the SAME parent but
 * different content — and the moment any replica holds both, it has a self-verifying
 * FORK-PROOF (the two signed events ARE the evidence; anyone recomputes the hashes to check).
 * A fork-proof folds to marking the author `disputed`, which then resolves via L4.
 *
 * Scope: only the governance / membership / key event types are chained — chat stays on the
 * mergeable L1 path (forking chat is normal, not an attack). See docs/decisions.md (2026-07-25).
 *
 * The chaining + fork detection themselves are the SHARED `createAuthorChain` primitive
 * (`@onderling/core`); this module is the governance BINDING of it — it supplies only the
 * governance-specific body serialization (which content fields define an event's identity).
 * Membership binds the same primitive with its own serialization; there is one copy of the logic.
 */
import { createAuthorChain } from '@onderling/core';

// The CONTENT fields that define a governance event's identity — deliberately excludes `at` and the
// chain fields (author/parentHash/hash): a re-delivery with the same content hashes the same
// (idempotent), while a genuinely different next-step from the same parent hashes differently.
const BODY_FIELDS = ['event', 'proposalId', 'action', 'subject', 'by', 'deadline', 'voter', 'choice', 'status'];

/** Deterministic serialization of a governance event over a fixed key order (stable across devices). */
function stableBody(event) {
  const parts = [];
  for (const k of BODY_FIELDS) {
    if (event[k] === undefined) continue;
    const v = event[k];
    parts.push(`${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v, Object.keys(v).sort()) : String(v)}`);
  }
  return parts.join('&');
}

// Bind the shared per-author-chain primitive to governance's body serialization. The hash input is
// `${author}|${parentHash}|${stableBody(event)}` exactly as before — byte-identical to the pre-lift chain.
const _chain = createAuthorChain(stableBody);

export const isChained       = _chain.isChained;
export const authorHead      = _chain.authorHead;
export const makeForkProof   = _chain.makeForkProof;
export const chainEvent      = _chain.chainEvent;
export const verifyForkProof = _chain.verifyForkProof;
export const detectForks     = _chain.detectForks;
export const foldDisputes    = _chain.foldDisputes;
