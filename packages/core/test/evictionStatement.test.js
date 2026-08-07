/**
 * evictionStatement — sign/verify a member eviction as a signed, replayable statement.
 * The circle enforces eviction, not one admin's device: any peer verifies the signature + applies it. Key
 * difference from originSignature: DURABLE — no freshness window (a peer offline for a week still applies it).
 */
import { describe, it, expect } from 'vitest';
import { signEviction, verifyEviction, EVICTION_STMT_VERSION } from '../src/security/evictionStatement.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

async function ids() {
  const admin = await AgentIdentity.generate(new VaultMemory());
  const mallory = await AgentIdentity.generate(new VaultMemory());
  return { admin, mallory };
}

describe('signEviction / verifyEviction', () => {
  it('round-trips: an authority signs, any peer verifies, body carries the facts', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'buurt-x', evicted: 'did:bram', at: 1000 });
    expect(stmt.by).toBe(admin.pubKey);
    expect(stmt.body).toMatchObject({ v: EVICTION_STMT_VERSION, kind: 'eviction', circleId: 'buurt-x', evicted: 'did:bram', by: admin.pubKey, at: 1000 });

    const res = verifyEviction(stmt, { expectedCircleId: 'buurt-x' });
    expect(res.ok).toBe(true);
    expect(res.body.evicted).toBe('did:bram');
  });

  it('is DURABLE — a very old statement still verifies (no freshness window, unlike originSignature)', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'did:x', at: 1 });   // epoch ms = 1 (ancient)
    expect(verifyEviction(stmt).ok).toBe(true);
  });

  it('tampering breaks the signature — a changed evicted member / circle no longer verifies', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'did:bram', at: 5 });
    expect(verifyEviction({ ...stmt, body: { ...stmt.body, evicted: 'did:cato' } }).ok).toBe(false);
    expect(verifyEviction({ ...stmt, body: { ...stmt.body, circleId: 'other' } }).ok).toBe(false);
  });

  it('a forged `by` (someone else claiming to be the signer) fails', async () => {
    const { admin, mallory } = await ids();
    const stmt = signEviction(admin, { circleId: 'c', evicted: 'did:x', at: 5 });
    // Mallory rewrites `by` to her key but can't produce admin's signature for the new body.
    expect(verifyEviction({ ...stmt, body: { ...stmt.body, by: mallory.pubKey } }).ok).toBe(false);
  });

  it('a statement for another circle is refused when a circle is expected', async () => {
    const { admin } = await ids();
    const stmt = signEviction(admin, { circleId: 'other-circle', evicted: 'did:x', at: 5 });
    expect(verifyEviction(stmt, { expectedCircleId: 'my-circle' })).toEqual({ ok: false, reason: 'circle mismatch' });
  });

  it('rejects malformed / wrong-version / wrong-kind statements', async () => {
    const { admin } = await ids();
    const good = signEviction(admin, { circleId: 'c', evicted: 'did:x', at: 5 });
    expect(verifyEviction(null).ok).toBe(false);
    expect(verifyEviction({ body: good.body }).ok).toBe(false);              // no sig
    expect(verifyEviction({ ...good, body: { ...good.body, v: 99 } }).ok).toBe(false);
    expect(verifyEviction({ ...good, body: { ...good.body, kind: 'mute' } }).ok).toBe(false);
  });

  it('signEviction guards its inputs', async () => {
    const { admin } = await ids();
    expect(() => signEviction(null, { circleId: 'c', evicted: 'x' })).toThrow(/identity/);
    expect(() => signEviction(admin, { evicted: 'x' })).toThrow(/circleId/);
    expect(() => signEviction(admin, { circleId: 'c' })).toThrow(/evicted/);
  });
});
