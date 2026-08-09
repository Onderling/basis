/**
 * evictionStatement — eviction is the `evict` KIND of the generic spine statement. Thin wrappers, so these
 * tests only cover the wrapper contract (kind = 'evict', subject = the evicted member); the substance lives in
 * spineStatement.test.js.
 */
import { describe, it, expect } from 'vitest';
import { signEviction, verifyEviction, EVICTION_KIND, EVICTION_STMT_VERSION } from '../src/security/evictionStatement.js';
import { signSpine, SPINE_STMT_VERSION } from '../src/security/spineStatement.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

const admin = () => AgentIdentity.generate(new VaultMemory());

describe('signEviction / verifyEviction (the `evict` spine kind)', () => {
  it('round-trips: subject IS the evicted member; kind is `evict`', async () => {
    const a = await admin();
    const stmt = signEviction(a, { circleId: 'buurt-x', evicted: 'circ:bram' });
    expect(stmt.by).toBe(a.pubKey);
    expect(stmt.body).toMatchObject({ v: SPINE_STMT_VERSION, kind: EVICTION_KIND, circleId: 'buurt-x', subject: 'circ:bram' });
    const res = verifyEviction(stmt, { expectedCircleId: 'buurt-x' });
    expect(res.ok).toBe(true);
    expect(res.body.subject).toBe('circ:bram');
  });

  it('chains to the issuer\'s previous spine head', async () => {
    const a = await admin();
    const first  = signEviction(a, { circleId: 'c', evicted: 'circ:x' });
    const second = signEviction(a, { circleId: 'c', evicted: 'circ:y', parent: first.body.hash });
    expect(second.body.parentHash).toBe(first.body.hash);
    expect(verifyEviction(second).ok).toBe(true);
  });

  it('verifyEviction refuses a non-evict spine kind (a role/leave statement is not an eviction)', async () => {
    const a = await admin();
    const role = signSpine(a, { kind: 'role', circleId: 'c', subject: 'circ:x', payload: { role: 'admin' } });
    expect(verifyEviction(role)).toEqual({ ok: false, reason: 'kind mismatch' });
  });

  it('guards `evicted`; the eviction version rides the spine version', async () => {
    const a = await admin();
    expect(() => signEviction(a, { circleId: 'c' })).toThrow(/evicted/);
    expect(EVICTION_STMT_VERSION).toBe(SPINE_STMT_VERSION);
  });
});
