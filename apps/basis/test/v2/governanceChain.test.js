/**
 * Governance hash-chain + fork-proofs (Phase 4 §5, L3) — the equivocation layer.
 *
 * The crux: a member who signs two contradictory events from the SAME parent (telling two
 * halves of the circle different things) is caught by a self-verifying fork-proof; an honest
 * chain (including a legitimate mind-change that ADVANCES the chain) is not. Fork-proofs
 * recompute from their own content, so tampered evidence is rejected.
 */
import { describe, it, expect } from 'vitest';
import {
  chainEvent, detectForks, verifyForkProof, makeForkProof, foldDisputes, authorHead, isChained,
} from '../../src/v2/governanceChain.js';
import { voteEvent } from '../../src/v2/governanceLog.js';

const vote = (proposalId, voter, choice) => voteEvent({ proposalId, voter, choice, at: 1 });

describe('chainEvent', () => {
  it('same content from the same parent hashes identically (idempotent re-delivery)', () => {
    const a = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const b = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    expect(a.hash).toBe(b.hash);
    expect(isChained(a)).toBe(true);
  });
  it('different content from the same parent hashes differently (a divergent next-step)', () => {
    const a = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const b = chainEvent(vote('p1', 'm0', 'no'), { author: 'm0', parentHash: 'g0' });
    expect(a.hash).not.toBe(b.hash);
  });
  it('at is NOT part of identity (a re-timestamped identical vote is not a divergence)', () => {
    const a = chainEvent(voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 1 }), { author: 'm0', parentHash: 'g0' });
    const b = chainEvent(voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 999 }), { author: 'm0', parentHash: 'g0' });
    expect(a.hash).toBe(b.hash);
  });
});

describe('equivocation detection', () => {
  it('catches a member voting yes to one peer and no to another (same parent, two contents)', () => {
    const yes = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const no  = chainEvent(vote('p1', 'm0', 'no'),  { author: 'm0', parentHash: 'g0' });   // FORK: same parent g0
    const forks = detectForks([yes, no]);
    expect(forks).toHaveLength(1);
    expect(forks[0]).toMatchObject({ kind: 'fork-proof', author: 'm0', parentHash: 'g0' });
    expect(verifyForkProof(forks[0])).toBe(true);
  });

  it('an honest chain (a mind-change that ADVANCES the chain) is NOT a fork', () => {
    const yes = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    // the flip references the previous event's hash as its parent → a single forward chain
    const no  = chainEvent(vote('p1', 'm0', 'no'),  { author: 'm0', parentHash: yes.hash });
    expect(detectForks([yes, no])).toHaveLength(0);
    expect(authorHead([yes, no], 'm0')).toBe(no.hash);   // the head advanced to the latest
  });

  it("two different authors sharing a parent value are not a fork (forks are per-author)", () => {
    const a = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const b = chainEvent(vote('p1', 'm1', 'no'),  { author: 'm1', parentHash: 'g0' });
    expect(detectForks([a, b])).toHaveLength(0);
  });

  it('idempotent duplicates of the same event are not a fork', () => {
    const a = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    expect(detectForks([a, { ...a }])).toHaveLength(0);
  });
});

describe('verifyForkProof — self-verifying evidence', () => {
  it('rejects tampered evidence (a hash that does not recompute from its content)', () => {
    const yes = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const no  = chainEvent(vote('p1', 'm0', 'no'),  { author: 'm0', parentHash: 'g0' });
    const tampered = makeForkProof(yes, { ...no, hash: 'deadbeef' });   // forged half
    expect(verifyForkProof(tampered)).toBe(false);
  });
  it('rejects a "fork" whose halves are actually identical (same hash)', () => {
    const yes = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    expect(verifyForkProof(makeForkProof(yes, { ...yes }))).toBe(false);
  });
});

describe('foldDisputes', () => {
  it('marks the forking author disputed — from the events and from a supplied proof', () => {
    const yes = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const no  = chainEvent(vote('p1', 'm0', 'no'),  { author: 'm0', parentHash: 'g0' });
    const honest = chainEvent(vote('p2', 'm1', 'yes'), { author: 'm1', parentHash: 'g0' });
    const disputed = foldDisputes({ events: [yes, no, honest] });
    expect([...disputed]).toEqual(['m0']);
    // an externally-minted proof folds in too (a peer relayed the evidence)
    const viaProof = foldDisputes({ events: [honest], forkProofs: [makeForkProof(yes, no)] });
    expect(viaProof.has('m0')).toBe(true);
  });
  it('a clean log disputes nobody', () => {
    const a = chainEvent(vote('p1', 'm0', 'yes'), { author: 'm0', parentHash: 'g0' });
    const b = chainEvent(vote('p1', 'm1', 'yes'), { author: 'm1', parentHash: 'g0' });
    expect(foldDisputes({ events: [a, b] }).size).toBe(0);
  });
});
