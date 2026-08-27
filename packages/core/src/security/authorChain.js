/**
 * authorChain.js — a per-author hash-chain with self-verifying fork-proofs, over a multi-parent deps-DAG.
 *
 * The reusable ORDERING + EQUIVOCATION primitive. Each event points at its author's previous head
 * (`parentHash`), so an honest author has one linear OWN chain: e1 ← e2 ← e3. Publishing two events with
 * the SAME parent but different content is a detectable FORK, and the two events ARE the proof —
 * anyone recomputes the hashes to check, no trust needed. A fork folds to marking the author disputed.
 *
 * MULTI-PARENT (the deps-DAG — DESIGN-log-ordering-unification §2–4). Beyond the author's OWN previous
 * head (`parentHash`), an event also carries `deps`: the CROSS-AUTHOR frontier — the heads by OTHER
 * authors the signer had already SEEN when signing (git `prev_events` / Automerge `deps`). Normally `deps`
 * is empty (you are the only writer, so the single tip is your own head); it grows only under genuine
 * concurrency and collapses the moment one event references the concurrent tips (a git-style merge). The
 * full seen-frontier of an event is therefore `{parentHash} ∪ deps`; `parentsOf` returns exactly that.
 *
 * WHY parentHash STAYS the self-chain (and deps is the cross-author extra), rather than merging both into
 * one frontier list: the EQUIVOCATION proof must stay keyed on the author's OWN previous head. A fork is
 * the author BRANCHING THEIR OWN CHAIN — two events both claiming the same self-parent. Keying detection on
 * `(author, parentHash)` catches that regardless of how the attacker varies the cross-author refs; keying
 * on the whole frontier would let an equivocator dodge detection by listing different other-author heads on
 * each branch. So parentHash + its fork machinery are UNCHANGED; `deps` only adds causal edges. `deps` is a
 * CHAIN field: bound into the hash + the signature, EXCLUDED from the content serializer — so two events off
 * the same self-parent with the same content but a DIFFERENT frontier hash differently and are a detectable
 * fork, exactly as parentHash is today. An empty `deps` hashes byte-identically to the pre-DAG single-parent
 * chain, so governance/eviction and every existing single-parent chain are unchanged.
 *
 * This is the SINGLE mechanism (P8, no parallel procedures): governance (proposals/votes), membership
 * (join/leave/evict/role) and any other per-author signed log BIND it with their own body-serialization
 * rather than reimplementing the chaining and fork detection. Only the body-serialization differs per
 * domain; the chaining, head-finding, frontier, reachability and fork detection live once, here.
 *
 * `serializeBody(event) -> string` is the domain's deterministic, cross-device-stable serialization of
 * the CONTENT that defines an event's identity — excluding volatile fields (a wall-clock `at`) and the
 * chain fields themselves (author/parentHash/deps/hash), so a re-delivery of the same content hashes
 * identically (idempotent) while a genuinely different next-step from the same frontier hashes differently.
 * Governance passes its field-ordered `stableBody`; a signed-body domain passes `canonicalize`.
 */
import { hashHex } from '../hashHex.js';

/** True for an event carrying the chain fields (author + hash). Domain-independent. */
export function isChained(e) {
  return !!e && typeof e === 'object' && typeof e.author === 'string' && typeof e.hash === 'string';
}

/** Canonical deps: string hashes only, de-duplicated, SORTED — a set, so frontier order never affects the hash. */
function canonDeps(deps) {
  if (!Array.isArray(deps)) return [];
  return [...new Set(deps.filter((h) => typeof h === 'string' && h))].sort();
}

/**
 * The parents of an event over the deps-DAG: its author's own previous head (`parentHash`) UNION the
 * cross-author frontier (`deps`). This is the edge set reachability + causal depth walk. Domain-independent.
 */
export function parentsOf(e) {
  if (!e || typeof e !== 'object') return [];
  const ps = [];
  if (typeof e.parentHash === 'string' && e.parentHash) ps.push(e.parentHash);
  if (Array.isArray(e.deps)) for (const h of e.deps) if (typeof h === 'string' && h) ps.push(h);
  return ps;
}

/**
 * The DAG frontier: the hashes of events NOT referenced as a parent (parentHash or deps) by any event in
 * the set — the current tips across ALL authors. A new event by an author uses its own tip as `parentHash`
 * and the remaining tips (concurrent other-author branches) as `deps`. Domain-independent.
 */
export function frontier(events) {
  const list = (Array.isArray(events) ? events : []).filter(isChained);
  const referenced = new Set();
  for (const e of list) for (const p of parentsOf(e)) referenced.add(p);
  return list.filter((e) => !referenced.has(e.hash)).map((e) => e.hash);
}

/** True when `targetHash` is a (strict) ancestor of `fromHash` — reachable walking UP the deps-DAG parents. */
function reaches(byHash, fromHash, targetHash) {
  const seen = new Set();
  const stack = parentsOf(byHash.get(fromHash)).slice();
  while (stack.length) {
    const h = stack.pop();
    if (h === targetHash) return true;
    if (seen.has(h)) continue;
    seen.add(h);
    const e = byHash.get(h);
    if (e) for (const p of parentsOf(e)) stack.push(p);
  }
  return false;
}

/**
 * Causal label of event `aHash` relative to `bHash` over the deps-DAG:
 *   'before'     — a is an ancestor of b (a happened-before b)
 *   'later'      — b is an ancestor of a (a happened-after b)
 *   'concurrent' — neither is an ancestor of the other (genuinely concurrent; also for a === b)
 * Cross-author, exact. Bounded by concurrency, not history length in the common (adjacent) case; a per-writer
 * vector cache is a later O(1) optimisation — never carried on the wire. Domain-independent.
 */
export function reachability(events, aHash, bHash) {
  const byHash = new Map((Array.isArray(events) ? events : []).filter(isChained).map((e) => [e.hash, e]));
  if (aHash === bHash) return 'concurrent';                 // an event is not before/after itself
  if (reaches(byHash, bHash, aHash)) return 'before';       // a is an ancestor of b
  if (reaches(byHash, aHash, bHash)) return 'later';        // b is an ancestor of a
  return 'concurrent';
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
  // The hash binds author + self-parent + the cross-author frontier + content. The deps segment is present
  // ONLY when deps is non-empty, so a single-parent event (deps = []) hashes byte-identically to the pre-DAG
  // chain — governance/eviction and every existing single-parent chain are unchanged. A non-empty frontier
  // is folded in as `deps=<sorted,comma-joined>|`, so same-content-different-frontier off one self-parent
  // hashes differently (a detectable fork), and a re-listing of the same frontier hashes identically.
  const hashOf = (author, parentHash, deps, body) => {
    const d = canonDeps(deps);
    const seg = d.length ? `deps=${d.join(',')}|` : '';
    return hashHex(`${author}|${parentHash ?? ''}|${seg}${body}`);
  };
  const recompute = (e) => hashOf(e.author, e.parentHash, e.deps, serializeBody(e));

  /**
   * Chain an event to its author's previous head (`parentHash`) and the cross-author frontier it had seen
   * (`deps`, default none). The hash binds author + parentHash + deps + content. `deps` lands on the event
   * ONLY when non-empty, so a plain single-parent event keeps its exact pre-DAG shape.
   */
  function chainEvent(event, { author, parentHash = null, deps = [] } = {}) {
    const d = canonDeps(deps);
    const hash = hashOf(author, parentHash, d, serializeBody(event));
    const out = { ...event, author, parentHash: parentHash ?? null, hash };
    if (d.length) out.deps = d;
    return out;
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
