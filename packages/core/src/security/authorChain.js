/**
 * authorChain.js — a per-author hash-chain with self-verifying fork-proofs.
 *
 * The reusable ORDERING + EQUIVOCATION primitive. Each event points at its author's previous head
 * (`parentHash`), so an honest author has one linear chain: e1 ← e2 ← e3. Publishing two events with
 * the SAME parent but different content is a detectable FORK, and the two events ARE the proof —
 * anyone recomputes the hashes to check, no trust needed. A fork folds to marking the author disputed.
 *
 * This is the SINGLE mechanism (P8, no parallel procedures): governance (proposals/votes), membership
 * (join/leave/evict/role) and any other per-author signed log BIND it with their own body-serialization
 * rather than reimplementing the chaining and fork detection. Only the body-serialization differs per
 * domain; the chaining, head-finding and fork detection live once, here.
 *
 * `serializeBody(event) -> string` is the domain's deterministic, cross-device-stable serialization of
 * the CONTENT that defines an event's identity — excluding volatile fields (a wall-clock `at`) and the
 * chain fields themselves, so a re-delivery of the same content hashes identically (idempotent) while a
 * genuinely different next-step from the same parent hashes differently. Governance passes its
 * field-ordered `stableBody`; a signed-body domain passes `canonicalize`.
 */
import { hashHex } from '../hashHex.js';

/** True for an event carrying the chain fields (author + hash). Domain-independent. */
export function isChained(e) {
  return !!e && typeof e === 'object' && typeof e.author === 'string' && typeof e.hash === 'string';
}

/**
 * The author's current chain HEAD (the hash to use as the next event's parent) — the one of the
 * author's events that no other of their events references as a parent. Null when the author has no
 * chained events yet. Ambiguous under an active fork (returns the first leaf); callers should resolve
 * the dispute before extending. Domain-independent (reads only the chain fields).
 */
export function authorHead(events, author) {
  const mine = (Array.isArray(events) ? events : []).filter((e) => isChained(e) && e.author === author);
  if (!mine.length) return null;
  const referenced = new Set(mine.map((e) => e.parentHash).filter(Boolean));
  const leaves = mine.filter((e) => !referenced.has(e.hash));
  return (leaves[0] ?? mine[mine.length - 1]).hash;
}

/**
 * A fork-proof record: two of ONE author's events sharing a parent but differing in content.
 * Self-verifying via a chain's `verifyForkProof`. Domain-independent.
 */
export function makeForkProof(a, b) {
  return { kind: 'fork-proof', author: a.author, parentHash: a.parentHash ?? null, a, b };
}

/**
 * Bind the chain to a domain's body-serialization. Returns the hash-computing operations (chainEvent +
 * the fork-proof verifier/detectors), plus the domain-independent helpers, as one import surface.
 *
 * @param {(event:object) => string} serializeBody  deterministic serialization of an event's identity
 * @returns {{ isChained: Function, authorHead: Function, makeForkProof: Function, chainEvent: Function,
 *            verifyForkProof: Function, detectForks: Function, foldDisputes: Function }}
 */
export function createAuthorChain(serializeBody) {
  if (typeof serializeBody !== 'function') {
    throw new Error('createAuthorChain: serializeBody(event) function required');
  }
  const recompute = (e) => hashHex(`${e.author}|${e.parentHash ?? ''}|${serializeBody(e)}`);

  /** Chain an event to its author's previous head. The hash binds author + parentHash + content. */
  function chainEvent(event, { author, parentHash = null } = {}) {
    const hash = hashHex(`${author}|${parentHash ?? ''}|${serializeBody(event)}`);
    return { ...event, author, parentHash: parentHash ?? null, hash };
  }

  /** Verify a fork-proof from scratch: same author + parent, both hashes recompute, genuinely divergent. */
  function verifyForkProof(proof) {
    const a = proof?.a; const b = proof?.b;
    if (!isChained(a) || !isChained(b)) return false;
    if (a.author !== b.author) return false;
    if ((a.parentHash ?? null) !== (b.parentHash ?? null)) return false;
    if (recompute(a) !== a.hash || recompute(b) !== b.hash) return false;  // evidence tampered
    return a.hash !== b.hash;                                              // genuinely a fork
  }

  /** For each (author, parentHash) with more than one distinct hash, emit a verified fork-proof. */
  function detectForks(events) {
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

  /** The set of disputed authors, from the events (detect) and/or externally-supplied fork-proofs. */
  function foldDisputes({ events = [], forkProofs = [] } = {}) {
    const disputed = new Set();
    for (const p of detectForks(events)) disputed.add(p.author);
    for (const p of Array.isArray(forkProofs) ? forkProofs : []) {
      if (verifyForkProof(p)) disputed.add(p.author);
    }
    return disputed;
  }

  return { isChained, authorHead, makeForkProof, chainEvent, verifyForkProof, detectForks, foldDisputes };
}
