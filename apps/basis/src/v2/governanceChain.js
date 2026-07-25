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
 */
import { hashHex } from '@onderling/core';

// The CONTENT fields that define an event's identity — deliberately excludes `at` and the
// chain fields (author/parentHash/hash): a re-delivery with the same content hashes the same
// (idempotent), while a genuinely different next-step from the same parent hashes differently.
const BODY_FIELDS = ['event', 'proposalId', 'action', 'subject', 'by', 'deadline', 'voter', 'choice', 'status'];

/** Deterministic serialization of an object over a fixed key order (stable across devices). */
function stableBody(event) {
  const parts = [];
  for (const k of BODY_FIELDS) {
    if (event[k] === undefined) continue;
    const v = event[k];
    parts.push(`${k}=${v !== null && typeof v === 'object' ? JSON.stringify(v, Object.keys(v).sort()) : String(v)}`);
  }
  return parts.join('&');
}

/** True for an event carrying the chain fields (author + hash). */
export function isChained(e) {
  return !!e && typeof e === 'object' && typeof e.author === 'string' && typeof e.hash === 'string';
}

/**
 * Chain an event to its author's previous head. The hash binds author + parentHash + content,
 * so the same content from the same parent is stable, and any divergence is detectable.
 * @param {object} event                the governance event (propose/vote/resolve)
 * @param {{author:string, parentHash?:string|null}} link
 * @returns {object} the event with { author, parentHash, hash }
 */
export function chainEvent(event, { author, parentHash = null } = {}) {
  const hash = hashHex(`${author}|${parentHash ?? ''}|${stableBody(event)}`);
  return { ...event, author, parentHash: parentHash ?? null, hash };
}

/** Recompute a chained event's hash from its own fields (evidence integrity check). */
function recomputeHash(e) {
  return hashHex(`${e.author}|${e.parentHash ?? ''}|${stableBody(e)}`);
}

/**
 * The author's current chain HEAD (the hash to use as the next event's parent) — the one of
 * the author's events that no other of their events references as a parent. Null when the
 * author has no chained events yet. Ambiguous under an active fork (returns the first leaf);
 * callers should resolve the dispute before extending.
 */
export function authorHead(events, author) {
  const mine = (Array.isArray(events) ? events : []).filter((e) => isChained(e) && e.author === author);
  if (!mine.length) return null;
  const referenced = new Set(mine.map((e) => e.parentHash).filter(Boolean));
  const leaves = mine.filter((e) => !referenced.has(e.hash));
  return (leaves[0] ?? mine[mine.length - 1]).hash;
}

/**
 * A fork-proof: two of ONE author's events sharing a parent but differing in content.
 * Self-verifying — `verifyForkProof` recomputes both hashes.
 */
export function makeForkProof(a, b) {
  return { kind: 'fork-proof', author: a.author, parentHash: a.parentHash ?? null, a, b };
}

/**
 * Verify a fork-proof from scratch: same author, same parent, both hashes recompute from
 * their own content (untampered), and the two are genuinely divergent. No trust needed.
 */
export function verifyForkProof(proof) {
  const a = proof?.a; const b = proof?.b;
  if (!isChained(a) || !isChained(b)) return false;
  if (a.author !== b.author) return false;
  if ((a.parentHash ?? null) !== (b.parentHash ?? null)) return false;
  if (recomputeHash(a) !== a.hash || recomputeHash(b) !== b.hash) return false;  // evidence tampered
  return a.hash !== b.hash;                                                       // genuinely a fork
}

/**
 * Scan chained events for equivocation: for each (author, parentHash) with more than one
 * distinct hash, emit a fork-proof over two conflicting events.
 * @returns {Array<object>} verified fork-proofs (one per forked author/parent)
 */
export function detectForks(events) {
  const groups = new Map();   // `${author}\n${parentHash}` → Map(hash → event)
  for (const e of Array.isArray(events) ? events : []) {
    if (!isChained(e)) continue;
    const key = `${e.author}\n${e.parentHash ?? ''}`;
    if (!groups.has(key)) groups.set(key, new Map());
    const m = groups.get(key);
    if (!m.has(e.hash)) m.set(e.hash, e);
  }
  const forks = [];
  for (const m of groups.values()) {
    if (m.size > 1) {
      const [a, b] = [...m.values()];
      const proof = makeForkProof(a, b);
      if (verifyForkProof(proof)) forks.push(proof);
    }
  }
  return forks;
}

/**
 * The set of disputed authors, from the chained events themselves (detect) and/or
 * externally-supplied fork-proof records (a replica may fold a peer's minted proof).
 * @param {object} a
 * @param {Array<object>} [a.events]       chained governance events
 * @param {Array<object>} [a.forkProofs]   fork-proof records to fold in
 * @returns {Set<string>} disputed author refs
 */
export function foldDisputes({ events = [], forkProofs = [] } = {}) {
  const disputed = new Set();
  for (const p of detectForks(events)) disputed.add(p.author);
  for (const p of Array.isArray(forkProofs) ? forkProofs : []) {
    if (verifyForkProof(p)) disputed.add(p.author);
  }
  return disputed;
}
