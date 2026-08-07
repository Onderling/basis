/**
 * authorChain — the reusable per-author hash-chain + fork-proof primitive.
 *
 * Governance's chain is now a BINDING of this (apps/basis/src/v2/governanceChain.js). These tests use a
 * DIFFERENT, non-governance body shape (a membership-like eviction body) on purpose: they prove the ONE
 * mechanism serves any domain that supplies its own body-serialization — the whole point of the lift.
 */
import { describe, it, expect } from 'vitest';
import { createAuthorChain, isChained, authorHead, makeForkProof } from '../src/security/authorChain.js';

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
