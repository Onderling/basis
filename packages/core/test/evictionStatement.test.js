/**
 * evictionStatement (v2) — sign/verify a member eviction as a signed, CHAINED, replayable spine statement.
 * The circle enforces eviction, not one admin's device: any peer verifies signature + chain integrity + applies
 * it. v2 rides the shared authorChain — `author` is the circle-scoped signer, `parentHash` is the issuer's
 * causal position (replaces v1's wall-clock `at`), and two evictions off the same parent with different content
 * hash differently (a detectable fork the roster fold resolves). Durable: no freshness window.
 */
import { describe, it, expect } from 'vitest';
import { signEviction, verifyEviction, EVICTION_STMT_VERSION } from '../src/security/evictionStatement.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

async function ids() {
  const admin = await AgentIdentity.generate(new VaultMemory());     // stands in for the circle-scoped signer
  const mallory = await AgentIdentity.generate(new VaultMemory());
  return { admin, mallory };
}

describe('signEviction / verifyEviction (v2 — chained spine statement)', () => {
  it('round-trips: a circle-scoped authority signs, any peer verifies; body carries the chain fields', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'buurt-x', evicted: 'circ:bram' });
    expect(stmt.by).toBe(admin.pubKey);
    expect(stmt.body).toMatchObject({
      v: EVICTION_STMT_VERSION, kind: 'eviction', circleId: 'buurt-x', evicted: 'circ:bram',
      author: admin.pubKey, parentHash: null,
    });
    expect(typeof stmt.body.hash).toBe('string');
    expect(EVICTION_STMT_VERSION).toBe('onderling/eviction.v2');

    const res = verifyEviction(stmt, { expectedCircleId: 'buurt-x' });
    expect(res.ok).toBe(true);
    expect(res.body.evicted).toBe('circ:bram');
  });

  it('chains to the issuer\'s previous spine head (the per-author causal position)', async () => {
    const { admin } = await ids();
    const first  = signEviction(admin, { circleId: 'c', evicted: 'circ:x' });
    const second = signEviction(admin, { circleId: 'c', evicted: 'circ:y', parent: first.body.hash });
    expect(second.body.parentHash).toBe(first.body.hash);
    expect(verifyEviction(second).ok).toBe(true);
  });

  it('is DURABLE — there is no timestamp/freshness window at all (verifies whenever received)', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'circ:x' });
    expect(verifyEviction(stmt).ok).toBe(true);
    expect('at' in stmt.body).toBe(false);   // v1's wall-clock field is gone
  });

  it('two evictions off the SAME parent with different content hash differently (a detectable fork)', async () => {
    const { admin } = await ids();
    const a = signEviction(admin, { circleId: 'c', evicted: 'circ:x', parent: 'g0' });
    const b = signEviction(admin, { circleId: 'c', evicted: 'circ:y', parent: 'g0' });
    expect(a.body.author).toBe(b.body.author);
    expect(a.body.parentHash).toBe(b.body.parentHash);
    expect(a.body.hash).not.toBe(b.body.hash);   // the fork the roster fold detects + resolves
  });

  it('tampering breaks it — a changed evicted member / circle no longer verifies', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'circ:bram' });
    expect(verifyEviction({ ...stmt, body: { ...stmt.body, evicted: 'circ:cato' } }).ok).toBe(false);
    expect(verifyEviction({ ...stmt, body: { ...stmt.body, circleId: 'other' } }).ok).toBe(false);
  });

  it('a rewritten parentHash breaks the chain hash', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'circ:x', parent: 'g0' });
    const res = verifyEviction({ ...stmt, body: { ...stmt.body, parentHash: 'g-forged' } });
    expect(res.ok).toBe(false);
  });

  it('a forged `author` (someone else claiming to be the signer) fails', async () => {
    const { admin, mallory } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'circ:x' });
    expect(verifyEviction({ ...stmt, body: { ...stmt.body, author: mallory.pubKey } }).ok).toBe(false);
  });

  it('a statement for another circle is refused when a circle is expected', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'other-circle', evicted: 'circ:x' });
    expect(verifyEviction(stmt, { expectedCircleId: 'my-circle' })).toEqual({ ok: false, reason: 'circle mismatch' });
  });

  it('rejects malformed / wrong-version / wrong-kind statements', async () => {
    const { admin } = await ids();
    const good = signEviction(admin, { circleId: 'c', evicted: 'circ:x' });
    expect(verifyEviction(null).ok).toBe(false);
    expect(verifyEviction({ body: good.body }).ok).toBe(false);              // no sig
    expect(verifyEviction({ ...good, body: { ...good.body, v: 'onderling/eviction.v1' } }).ok).toBe(false);
    expect(verifyEviction({ ...good, body: { ...good.body, kind: 'mute' } }).ok).toBe(false);
  });

  it('signEviction guards its inputs', async () => {
    const { admin } = await ids();
    expect(() => signEviction(null, { circleId: 'c', evicted: 'x' })).toThrow(/identity/);
    expect(() => signEviction(admin, { evicted: 'x' })).toThrow(/circleId/);
    expect(() => signEviction(admin, { circleId: 'c' })).toThrow(/evicted/);
    expect(() => signEviction(admin, { circleId: 'c', evicted: 'x', parent: 123 })).toThrow(/parent/);
  });
});
