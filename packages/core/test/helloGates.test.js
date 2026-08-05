/**
 * helloGates — ready-made gate predicates (Group W).
 */
import { describe, it, expect, vi } from 'vitest';
import { tokenGate, groupGate, anyOf, firstContactRateGate } from '../src/security/helloGates.js';

const env = (payload = {}) => ({ _from: 'alice', payload });
const envFrom = (from, payload = {}) => ({ _from: from, payload });

describe('tokenGate', () => {
  it('accepts when authToken matches', async () => {
    const gate = tokenGate('sesame');
    expect(await gate(env({ authToken: 'sesame' }))).toBe(true);
  });

  it('rejects on wrong token', async () => {
    const gate = tokenGate('sesame');
    expect(await gate(env({ authToken: 'wrong' }))).toBe(false);
  });

  it('rejects when authToken is missing', async () => {
    const gate = tokenGate('sesame');
    expect(await gate(env({}))).toBe(false);
    expect(await gate(env())).toBe(false);
    expect(await gate({ _from: 'alice' })).toBe(false);
  });

  it('throws when constructed with an empty secret', () => {
    expect(() => tokenGate('')).toThrow();
    expect(() => tokenGate(null)).toThrow();
  });
});

describe('groupGate', () => {
  it('accepts a valid proof for one of the groupIds', async () => {
    const gm = {
      verifyProof: vi.fn(async (_proof, gid) => gid === 'team-a'),
    };
    const gate = groupGate(['team-a', 'team-b'], gm);
    const ok = await gate(env({ authToken: { gid: 'team-a', sig: 'x' } }));
    expect(ok).toBe(true);
  });

  it('rejects when no group matches', async () => {
    const gm = { verifyProof: vi.fn(async () => false) };
    const gate = groupGate(['team-a'], gm);
    expect(await gate(env({ authToken: { sig: 'x' } }))).toBe(false);
  });

  it('rejects when authToken is absent', async () => {
    const gm = { verifyProof: vi.fn(async () => true) };
    const gate = groupGate(['team-a'], gm);
    expect(await gate(env({}))).toBe(false);
    expect(gm.verifyProof).not.toHaveBeenCalled();
  });

  it('fail-closed when verifyProof throws', async () => {
    const gm = { verifyProof: async () => { throw new Error('kaboom'); } };
    const gate = groupGate(['team-a'], gm);
    expect(await gate(env({ authToken: {} }))).toBe(false);
  });

  it('throws on bad construction args', () => {
    expect(() => groupGate([],   { verifyProof: () => {} })).toThrow();
    expect(() => groupGate(['a'], null)).toThrow();
  });
});

describe('anyOf', () => {
  const yes = async () => true;
  const no  = async () => false;
  const bad = async () => { throw new Error('x'); };

  it('passes if any sub-gate passes', async () => {
    const gate = anyOf(no, yes, no);
    expect(await gate(env())).toBe(true);
  });

  it('rejects if all sub-gates reject', async () => {
    const gate = anyOf(no, no, no);
    expect(await gate(env())).toBe(false);
  });

  it('tolerates a throwing sub-gate and keeps checking the rest', async () => {
    const gate = anyOf(bad, yes);
    expect(await gate(env())).toBe(true);
  });

  it('short-circuits on the first accept', async () => {
    const spy = vi.fn(async () => true);
    const gate = anyOf(yes, spy);
    await gate(env());
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts zero arguments as always-reject', async () => {
    const gate = anyOf();
    expect(await gate(env())).toBe(false);
  });
});

describe('firstContactRateGate', () => {
  it('a KNOWN sender always passes (bounds only NEW registrations)', async () => {
    const gate = firstContactRateGate({ isKnown: async () => true, maxPerWindow: 1 });
    for (let i = 0; i < 10; i += 1) expect(await gate(envFrom(`peer${i}`))).toBe(true);
  });

  it('bounds NEW senders to maxPerWindow within the window', async () => {
    let t = 1000;
    const gate = firstContactRateGate({ isKnown: async () => false, maxPerWindow: 3, windowMs: 100, now: () => t });
    expect(await gate(envFrom('a'))).toBe(true);
    expect(await gate(envFrom('b'))).toBe(true);
    expect(await gate(envFrom('c'))).toBe(true);
    expect(await gate(envFrom('d'))).toBe(false);   // 4th NEW sender in the window — bounded
    expect(await gate(envFrom('e'))).toBe(false);
  });

  it('the window slides — after windowMs, NEW senders are accepted again', async () => {
    let t = 1000;
    const gate = firstContactRateGate({ isKnown: async () => false, maxPerWindow: 2, windowMs: 100, now: () => t });
    expect(await gate(envFrom('a'))).toBe(true);
    expect(await gate(envFrom('b'))).toBe(true);
    expect(await gate(envFrom('c'))).toBe(false);   // over the cap
    t += 101;                                        // the window drains
    expect(await gate(envFrom('d'))).toBe(true);     // accepted again
  });

  it('a KNOWN peer is unaffected by a concurrent flood of NEW senders', async () => {
    const t = 1000;
    const known = new Set(['trusted']);
    const gate = firstContactRateGate({ isKnown: async (from) => known.has(from), maxPerWindow: 1, windowMs: 100, now: () => t });
    expect(await gate(envFrom('newbie'))).toBe(true);   // fills the window
    expect(await gate(envFrom('flood'))).toBe(false);   // bounded
    expect(await gate(envFrom('trusted'))).toBe(true);  // KNOWN → still passes despite the flood
  });

  it('throws without an isKnown predicate', () => {
    expect(() => firstContactRateGate({})).toThrow(/isKnown/);
  });
});
