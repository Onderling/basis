/**
 * spineStatement — the generic signed, chained SPINE statement (governance · roles · membership · keys ride
 * ONE per-author chain, filterable by kind). Any kind signs/verifies the same way here; only the fold is
 * kind-aware. `author` is the circle-scoped signer; `parentHash` is the causal position; a payload is
 * canonicalised into both the chain hash and the signature. Durable, no freshness window.
 */
import { describe, it, expect } from 'vitest';
import { signSpine, verifySpine, SPINE_STMT_VERSION } from '../src/security/spineStatement.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

async function ids() {
  const admin = await AgentIdentity.generate(new VaultMemory());   // stands in for the circle-scoped signer
  const mallory = await AgentIdentity.generate(new VaultMemory());
  return { admin, mallory };
}

describe('signSpine / verifySpine (generic spine chain)', () => {
  it('round-trips any kind, carrying the chain fields + a payload', async () => {
    const { admin } = await ids();
    const stmt = signSpine(admin, { kind: 'role', circleId: 'c', subject: 'circ:bram', payload: { role: 'admin' } });
    expect(stmt.by).toBe(admin.pubKey);
    expect(stmt.body).toMatchObject({
      v: SPINE_STMT_VERSION, kind: 'role', circleId: 'c', subject: 'circ:bram',
      payload: { role: 'admin' }, author: admin.pubKey, parentHash: null,
    });
    expect(typeof stmt.body.hash).toBe('string');
    expect(SPINE_STMT_VERSION).toBe('onderling/spine.v1');
    expect(verifySpine(stmt, { expectedCircleId: 'c', expectedKind: 'role' }).ok).toBe(true);
  });

  it('every spine kind signs + verifies the same way (extensible — the fold, not this, is kind-aware)', async () => {
    const { admin } = await ids();
    for (const kind of ['evict', 'leave', 'join', 'role', 'key', 'some-third-party-kind']) {
      const stmt = signSpine(admin, { kind, circleId: 'c', subject: 'circ:x' });
      expect(verifySpine(stmt, { expectedKind: kind }).ok).toBe(true);
    }
  });

  it('chains to the issuer\'s previous spine head (the per-author causal position)', async () => {
    const { admin } = await ids();
    const first  = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x' });
    const second = signSpine(admin, { kind: 'role', circleId: 'c', subject: 'circ:y', payload: { role: 'member' }, parent: first.body.hash });
    expect(second.body.parentHash).toBe(first.body.hash);
    expect(verifySpine(second).ok).toBe(true);
  });

  it('is DURABLE — no timestamp/freshness window (verifies whenever received)', async () => {
    const { admin } = await ids();
    const stmt = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x' });
    expect(verifySpine(stmt).ok).toBe(true);
    expect('at' in stmt.body).toBe(false);
  });

  it('two entries off the SAME parent with different content hash differently (a detectable fork)', async () => {
    const { admin } = await ids();
    const a = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x', parent: 'g0' });
    const b = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:y', parent: 'g0' });
    expect(a.body.author).toBe(b.body.author);
    expect(a.body.parentHash).toBe(b.body.parentHash);
    expect(a.body.hash).not.toBe(b.body.hash);
  });

  it('carries + verifies a multi-parent deps frontier (canonical set); a single-parent body has no deps field', async () => {
    const { admin } = await ids();
    const multi = signSpine(admin, { kind: 'role', circleId: 'c', subject: 'circ:x', payload: { role: 'admin' },
      parent: 'g0', deps: ['h2', 'h1', 'h2'] });
    expect(multi.body.deps).toEqual(['h1', 'h2']);           // sorted + deduped set
    expect(verifySpine(multi).ok).toBe(true);
    const solo = signSpine(admin, { kind: 'role', circleId: 'c', subject: 'circ:x', parent: 'g0' });
    expect('deps' in solo.body).toBe(false);                 // single-parent shape unchanged
    expect(verifySpine(solo).ok).toBe(true);
  });

  it('the signature + chain hash authenticate the deps frontier — tampering it no longer verifies', async () => {
    const { admin } = await ids();
    const stmt = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x', parent: 'g0', deps: ['h1'] });
    expect(verifySpine({ ...stmt, body: { ...stmt.body, deps: ['h1', 'h9'] } }).ok).toBe(false);   // added a dep
    expect(verifySpine({ ...stmt, body: { ...stmt.body, deps: [] } }).ok).toBe(false);             // dropped the frontier
    expect(verifySpine({ ...stmt, body: { ...stmt.body, deps: 'nope' } }))
      .toEqual({ ok: false, reason: 'body.deps must be an array of hash strings' });
  });

  it('MULTI-PARENT EQUIVOCATION stays a detectable fork — same author + parent + content, DIFFERENT frontier', async () => {
    const { admin } = await ids();
    // Same content off the same self-parent, but two different frontiers → the deps-in-hash makes them diverge,
    // so the equivocation (showing peers different "what I had seen") is caught exactly as a content fork is.
    const a = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x', parent: 'g0', deps: ['h1'] });
    const b = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x', parent: 'g0', deps: ['h2'] });
    expect(a.body.author).toBe(b.body.author);
    expect(a.body.parentHash).toBe(b.body.parentHash);
    expect(a.body.hash).not.toBe(b.body.hash);
    expect(verifySpine(a).ok && verifySpine(b).ok).toBe(true);   // each is individually valid — a genuine fork
  });

  it('tampering breaks it — changed subject / circle / kind / payload / parent no longer verify', async () => {
    const { admin } = await ids();
    const stmt = signSpine(admin, { kind: 'role', circleId: 'c', subject: 'circ:x', payload: { role: 'admin' }, parent: 'g0' });
    expect(verifySpine({ ...stmt, body: { ...stmt.body, subject: 'circ:y' } }).ok).toBe(false);
    expect(verifySpine({ ...stmt, body: { ...stmt.body, circleId: 'other' } }).ok).toBe(false);
    expect(verifySpine({ ...stmt, body: { ...stmt.body, kind: 'evict' } }).ok).toBe(false);
    expect(verifySpine({ ...stmt, body: { ...stmt.body, payload: { role: 'member' } } }).ok).toBe(false);
    expect(verifySpine({ ...stmt, body: { ...stmt.body, parentHash: 'g-forged' } }).ok).toBe(false);
  });

  it('a forged author fails; a kind/circle expectation is enforced', async () => {
    const { admin, mallory } = await ids();
    const stmt = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x' });
    expect(verifySpine({ ...stmt, body: { ...stmt.body, author: mallory.pubKey } }).ok).toBe(false);
    expect(verifySpine(stmt, { expectedKind: 'role' })).toEqual({ ok: false, reason: 'kind mismatch' });
    expect(verifySpine(stmt, { expectedCircleId: 'other' })).toEqual({ ok: false, reason: 'circle mismatch' });
  });

  it('rejects malformed / wrong-version statements', async () => {
    const { admin } = await ids();
    const good = signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'circ:x' });
    expect(verifySpine(null).ok).toBe(false);
    expect(verifySpine({ body: good.body }).ok).toBe(false);
    expect(verifySpine({ ...good, body: { ...good.body, v: 'onderling/spine.v0' } }).ok).toBe(false);
  });

  it('signSpine guards its inputs', async () => {
    const { admin } = await ids();
    expect(() => signSpine(null, { kind: 'evict', circleId: 'c', subject: 'x' })).toThrow(/identity/);
    expect(() => signSpine(admin, { circleId: 'c', subject: 'x' })).toThrow(/kind/);
    expect(() => signSpine(admin, { kind: 'evict', subject: 'x' })).toThrow(/circleId/);
    expect(() => signSpine(admin, { kind: 'evict', circleId: 'c' })).toThrow(/subject/);
    expect(() => signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'x', payload: 'nope' })).toThrow(/payload/);
    expect(() => signSpine(admin, { kind: 'evict', circleId: 'c', subject: 'x', parent: 123 })).toThrow(/parent/);
  });
});
