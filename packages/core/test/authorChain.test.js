/**
 * authorChain — the reusable per-author hash-chain + fork-proof primitive.
 *
 * Governance's chain is now a BINDING of this (apps/basis/src/v2/governanceChain.js). These tests use a
 * DIFFERENT, non-governance body shape (a membership-like eviction body) on purpose: they prove the ONE
 * mechanism serves any domain that supplies its own body-serialization — the whole point of the lift.
 */
import { describe, it, expect } from 'vitest';
import {
  createAuthorChain, isChained, authorHead, makeForkProof,
  parentsOf, frontier, reachability,
} from '../src/security/authorChain.js';

// A membership-flavoured serializer: identity is the eviction content, NOT the volatile `at`.
const serialize = (e) => `${e.kind}|${e.circleId}|${e.evicted}|${e.seq}`;
const chain = createAuthorChain(serialize);
const evt = (evicted, seq, at = 1) => ({ kind: 'eviction', circleId: 'buurt-x', evicted, seq, at });

describe('createAuthorChain — reusable across domains', () => {
  it('requires a serializer', () => {
    expect(() => createAuthorChain()).toThrow(/serializeBody/);
    expect(() => createAuthorChain('nope')).toThrow(/serializeBody/);
  });

  it('same content from the same parent hashes identically (idempotent); volatile fields excluded', () => {
    const a = chain.chainEvent(evt('did:bram', 1, 100), { author: 'admin0', parentHash: 'g0' });
    const b = chain.chainEvent(evt('did:bram', 1, 999), { author: 'admin0', parentHash: 'g0' });  // different `at`
    expect(a.hash).toBe(b.hash);
    expect(isChained(a)).toBe(true);
  });

  it('different content from the same parent diverges', () => {
    const a = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    const b = chain.chainEvent(evt('did:cato', 1), { author: 'admin0', parentHash: 'g0' });
    expect(a.hash).not.toBe(b.hash);
  });

  it('authorHead advances along a single forward chain', () => {
    const e1 = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    const e2 = chain.chainEvent(evt('did:cato', 2), { author: 'admin0', parentHash: e1.hash });
    expect(authorHead([e1, e2], 'admin0')).toBe(e2.hash);
  });

  it('detects an equivocation (two contents off the same parent) — per author', () => {
    const a  = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    const b  = chain.chainEvent(evt('did:cato', 1), { author: 'admin0', parentHash: 'g0' });   // FORK
    const ok = chain.chainEvent(evt('did:dana', 1), { author: 'admin1', parentHash: 'g0' });   // other author
    const forks = chain.detectForks([a, b, ok]);
    expect(forks).toHaveLength(1);
    expect(forks[0]).toMatchObject({ kind: 'fork-proof', author: 'admin0', parentHash: 'g0' });
    expect(chain.verifyForkProof(forks[0])).toBe(true);
    expect([...chain.foldDisputes({ events: [a, b, ok] })]).toEqual(['admin0']);
  });

  it('an advancing mind-change is NOT a fork', () => {
    const a = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    const b = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: a.hash });  // forward
    expect(chain.detectForks([a, b])).toHaveLength(0);
  });

  it('verifyForkProof rejects tampered evidence', () => {
    const a = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    const b = chain.chainEvent(evt('did:cato', 1), { author: 'admin0', parentHash: 'g0' });
    expect(chain.verifyForkProof(makeForkProof(a, { ...b, hash: 'deadbeef' }))).toBe(false);
    expect(chain.verifyForkProof(makeForkProof(a, { ...a }))).toBe(false);  // identical halves ≠ fork
  });

  it('two independently-created chains over the same serializer agree on hashes (cross-device stable)', () => {
    const c2 = createAuthorChain(serialize);
    const a = chain.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    const b = c2.chainEvent(evt('did:bram', 1), { author: 'admin0', parentHash: 'g0' });
    expect(a.hash).toBe(b.hash);
  });
});

// ── The multi-parent deps-DAG (DESIGN-log-ordering-unification §2–4) ────────────────────────────────────
describe('createAuthorChain — the multi-parent deps-DAG', () => {
  // A tiny cross-author DAG:  e1 ← e2  (author w1);  e3 is a concurrent root (author w2);
  // merge references e2 (its own parent) AND e3 (a cross-author dep) — a git-style merge that collapses the
  // two live tips back to one.
  const e1 = chain.chainEvent(evt('did:a', 1), { author: 'w1', parentHash: null });
  const e2 = chain.chainEvent(evt('did:b', 2), { author: 'w1', parentHash: e1.hash });
  const e3 = chain.chainEvent(evt('did:c', 3), { author: 'w2', parentHash: null });
  const merge = chain.chainEvent(evt('did:d', 4), { author: 'w1', parentHash: e2.hash, deps: [e3.hash] });
  const dag = [e1, e2, e3, merge];

  it('a single-parent event (no/empty deps) is byte-identical to the pre-DAG chain — no deps field, same hash', () => {
    const withNone  = chain.chainEvent(evt('did:x', 9), { author: 'w1', parentHash: 'p' });
    const withEmpty = chain.chainEvent(evt('did:x', 9), { author: 'w1', parentHash: 'p', deps: [] });
    expect('deps' in withNone).toBe(false);
    expect('deps' in withEmpty).toBe(false);
    expect(withNone.hash).toBe(withEmpty.hash);
  });

  it('a multi-parent event carries a canonical (sorted, deduped) deps set, and the frontier order is irrelevant', () => {
    const a = chain.chainEvent(evt('did:d', 4), { author: 'w1', parentHash: e2.hash, deps: [e3.hash, e1.hash] });
    const b = chain.chainEvent(evt('did:d', 4), { author: 'w1', parentHash: e2.hash, deps: [e1.hash, e3.hash, e1.hash] });
    expect(a.deps).toEqual([e1.hash, e3.hash].sort());   // sorted + deduped
    expect(a.hash).toBe(b.hash);                          // reordering / duplicating the frontier ≠ a new event
  });

  it('parentsOf unions the self-parent + the cross-author deps; frontier is the single live tip after a merge', () => {
    expect(parentsOf(merge).sort()).toEqual([e2.hash, e3.hash].sort());
    expect(parentsOf(e1)).toEqual([]);
    expect(frontier(dag)).toEqual([merge.hash]);          // the merge collapsed both tips to one
    expect(frontier([e1, e2, e3]).sort()).toEqual([e2.hash, e3.hash].sort());   // two live tips before the merge
  });

  it('reachability labels before / concurrent / later over the DAG (cross-author, exact)', () => {
    expect(reachability(dag, e1.hash, e2.hash)).toBe('before');       // e1 is an ancestor of e2
    expect(reachability(dag, e2.hash, e1.hash)).toBe('later');        // symmetric
    expect(reachability(dag, e1.hash, e3.hash)).toBe('concurrent');   // different authors, no edge
    expect(reachability(dag, e2.hash, e3.hash)).toBe('concurrent');
    expect(reachability(dag, e3.hash, merge.hash)).toBe('before');    // reached via the cross-author dep edge
    expect(reachability(dag, e1.hash, merge.hash)).toBe('before');    // reached transitively (e1←e2←merge)
    expect(reachability(dag, merge.hash, e1.hash)).toBe('later');
    expect(reachability(dag, merge.hash, merge.hash)).toBe('concurrent');   // an event is not before/after itself
  });

  it('FORK DETECTION STILL FIRES under multi-parent — same content off one self-parent with a DIFFERENT frontier is a fork', () => {
    const base  = chain.chainEvent(evt('did:x', 1), { author: 'w1', parentHash: 'g0' });
    // Two events: SAME author, SAME parentHash, SAME content — but a DIFFERENT deps frontier. Because deps is
    // bound into the hash but excluded from the content serializer, this equivocation hashes differently.
    const forkA = chain.chainEvent(evt('did:y', 2), { author: 'w1', parentHash: base.hash, deps: [e3.hash] });
    const forkB = chain.chainEvent(evt('did:y', 2), { author: 'w1', parentHash: base.hash, deps: [e1.hash] });
    expect(forkA.hash).not.toBe(forkB.hash);
    const forks = chain.detectForks([base, forkA, forkB]);
    expect(forks).toHaveLength(1);
    expect(forks[0]).toMatchObject({ kind: 'fork-proof', author: 'w1', parentHash: base.hash });
    expect(chain.verifyForkProof(forks[0])).toBe(true);
    expect([...chain.foldDisputes({ events: [base, forkA, forkB] })]).toEqual(['w1']);
  });

  it('re-listing the SAME frontier is idempotent, not a fork (same author + parent + content + deps → one hash)', () => {
    const base = chain.chainEvent(evt('did:x', 1), { author: 'w1', parentHash: 'g0' });
    const a = chain.chainEvent(evt('did:y', 2), { author: 'w1', parentHash: base.hash, deps: [e1.hash, e3.hash] });
    const b = chain.chainEvent(evt('did:y', 2), { author: 'w1', parentHash: base.hash, deps: [e3.hash, e1.hash] });
    expect(a.hash).toBe(b.hash);
    expect(chain.detectForks([base, a, b])).toHaveLength(0);
  });
});
