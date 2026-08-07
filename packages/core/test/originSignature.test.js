/**
 * originSignature — sign/verify helpers (Group Z2).
 * See Design-v3/origin-signature.md §2/§5 and CODING-PLAN.md Group Z2.
 */
import { describe, it, expect } from 'vitest';
import {
  signOrigin,
  verifyOrigin,
  ORIGIN_SIG_VERSION,
  DEFAULT_ORIGIN_WINDOW_MS,
}                          from '../src/security/originSignature.js';
import { AgentIdentity }   from '../src/identity/AgentIdentity.js';
import { VaultMemory }     from '@onderling/vault';
import { TextPart }         from '../src/Parts.js';

async function ids() {
  const alice = await AgentIdentity.generate(new VaultMemory());
  const carol = await AgentIdentity.generate(new VaultMemory());
  return { alice, carol };
}

describe('signOrigin / verifyOrigin — round trip', () => {
  it('signs and verifies a fresh claim', async () => {
    const { alice, carol } = await ids();
    const parts = [TextPart('hi')];

    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey,
      skill:  'receive-message',
      parts,
    });

    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: {
        v:      ORIGIN_SIG_VERSION,
        target: carol.pubKey,
        skill:  'receive-message',
        parts,
        ts:     originTs,
      },
    }, { expectedPubKey: carol.pubKey });

    expect(res).toEqual({ ok: true });
  });

  it('returns the same ts the caller supplied', async () => {
    const { alice, carol } = await ids();
    const { originTs } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [], ts: 12345,
    });
    expect(originTs).toBe(12345);
  });

  it('defaults ts to Date.now() when omitted', async () => {
    const { alice, carol } = await ids();
    const before = Date.now();
    const { originTs } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [],
    });
    const after = Date.now();
    expect(originTs).toBeGreaterThanOrEqual(before);
    expect(originTs).toBeLessThanOrEqual(after);
  });
});

describe('verifyOrigin — tampering detection', () => {
  async function signedClaim(mut = x => x) {
    const { alice, carol } = await ids();
    const parts = [TextPart('hi')];
    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey, skill: 'receive-message', parts,
    });
    const claim = {
      origin: alice.pubKey,
      sig,
      body: {
        v:      ORIGIN_SIG_VERSION,
        target: carol.pubKey,
        skill:  'receive-message',
        parts,
        ts:     originTs,
      },
    };
    mut(claim);
    return { claim, carolPubKey: carol.pubKey, alicePubKey: alice.pubKey };
  }

  it('rejects tampered parts', async () => {
    const { claim, carolPubKey } = await signedClaim(c => {
      c.body.parts = [TextPart('MODIFIED')];
    });
    const res = verifyOrigin(claim, { expectedPubKey: carolPubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });

  it('rejects tampered skill', async () => {
    const { claim, carolPubKey } = await signedClaim(c => {
      c.body.skill = 'impersonate';
    });
    const res = verifyOrigin(claim, { expectedPubKey: carolPubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });

  it('rejects tampered target (when it still passes the reflection check)', async () => {
    // Set body.target to a different value and also pass that as
    // expectedPubKey so the reflection check doesn't catch it first —
    // sig verification should still fail.
    const { claim } = await signedClaim(c => {
      c.body.target = 'someone-else-pubkey';
    });
    const res = verifyOrigin(claim, { expectedPubKey: 'someone-else-pubkey' });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });

  it('rejects tampered ts', async () => {
    const { claim, carolPubKey } = await signedClaim(c => {
      c.body.ts = c.body.ts + 1;
    });
    const res = verifyOrigin(claim, { expectedPubKey: carolPubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bad signature/);
  });
});

describe('verifyOrigin — reflection guard', () => {
  it('rejects when body.target does not match expectedPubKey', async () => {
    const { alice, carol } = await ids();
    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [],
    });
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: {
        v: ORIGIN_SIG_VERSION, target: carol.pubKey, skill: 's', parts: [], ts: originTs,
      },
    }, { expectedPubKey: 'a-different-pubkey' });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/target mismatch/);
  });
});

describe('verifyOrigin — timestamp window', () => {
  it('accepts timestamps inside the window', async () => {
    const { alice, carol } = await ids();
    const now = 1_700_000_000_000;
    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [], ts: now,
    });
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: { v: ORIGIN_SIG_VERSION, target: carol.pubKey, skill: 's', parts: [], ts: originTs },
    }, { expectedPubKey: carol.pubKey, now: now + 5 * 60_000 });  // +5 min

    expect(res.ok).toBe(true);
  });

  it('rejects stale timestamps (past the window)', async () => {
    const { alice, carol } = await ids();
    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [], ts: 1_700_000_000_000,
    });
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: { v: ORIGIN_SIG_VERSION, target: carol.pubKey, skill: 's', parts: [], ts: originTs },
    }, {
      expectedPubKey: carol.pubKey,
      now:            1_700_000_000_000 + 15 * 60_000,  // +15 min, outside 10 min window
    });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/outside.*window/);
  });

  it('rejects future timestamps past the window', async () => {
    const { alice, carol } = await ids();
    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [], ts: 1_700_000_000_000 + 15 * 60_000,
    });
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: { v: ORIGIN_SIG_VERSION, target: carol.pubKey, skill: 's', parts: [], ts: originTs },
    }, { expectedPubKey: carol.pubKey, now: 1_700_000_000_000 });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/outside.*window/);
  });

  it('windowMs is configurable', async () => {
    const { alice, carol } = await ids();
    const now = 1_700_000_000_000;
    const { originTs, sig } = signOrigin(alice, {
      target: carol.pubKey, skill: 's', parts: [], ts: now,
    });
    // A tight 1-second window rejects a 5-second-old claim.
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: { v: ORIGIN_SIG_VERSION, target: carol.pubKey, skill: 's', parts: [], ts: originTs },
    }, { expectedPubKey: carol.pubKey, now: now + 5_000, windowMs: 1_000 });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/outside.*window/);
  });
});

describe('verifyOrigin — structure rejects', () => {
  it('rejects missing origin', () => {
    const res = verifyOrigin({ sig: 'x', body: {} }, { expectedPubKey: 'p' });
    expect(res).toEqual({ ok: false, reason: 'missing origin' });
  });

  it('rejects missing sig', () => {
    const res = verifyOrigin({ origin: 'p', body: {} }, { expectedPubKey: 'p' });
    expect(res).toEqual({ ok: false, reason: 'missing signature' });
  });

  it('rejects missing body', () => {
    const res = verifyOrigin({ origin: 'p', sig: 'x' }, { expectedPubKey: 'p' });
    expect(res).toEqual({ ok: false, reason: 'missing body' });
  });

  it('rejects unsupported version', async () => {
    const { alice, carol } = await ids();
    const { originTs, sig } = signOrigin(alice, { target: carol.pubKey, skill: 's', parts: [] });
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: { v: 99, target: carol.pubKey, skill: 's', parts: [], ts: originTs },
    }, { expectedPubKey: carol.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/unsupported version/);
  });

  it('rejects non-array parts', async () => {
    const { alice, carol } = await ids();
    const { originTs, sig } = signOrigin(alice, { target: carol.pubKey, skill: 's', parts: [] });
    const res = verifyOrigin({
      origin: alice.pubKey,
      sig,
      body: { v: ORIGIN_SIG_VERSION, target: carol.pubKey, skill: 's', parts: 'not-an-array', ts: originTs },
    }, { expectedPubKey: carol.pubKey });
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/parts must be an array/);
  });
});

describe('signOrigin — argument validation', () => {
  it('throws without an identity', () => {
    expect(() => signOrigin(null, { target: 't', skill: 's', parts: [] }))
      .toThrow(/identity required/);
  });
  it('throws without target', async () => {
    const { alice } = await ids();
    expect(() => signOrigin(alice, { target: '', skill: 's', parts: [] }))
      .toThrow(/target required/);
  });
  it('throws without skill', async () => {
    const { alice } = await ids();
    expect(() => signOrigin(alice, { target: 't', skill: '', parts: [] }))
      .toThrow(/skill required/);
  });
  it('throws when parts is not an array', async () => {
    const { alice } = await ids();
    expect(() => signOrigin(alice, { target: 't', skill: 's', parts: 'no' }))
      .toThrow(/parts must be an array/);
  });
});

describe('constants', () => {
  it('DEFAULT_ORIGIN_WINDOW_MS is 10 min', () => {
    expect(DEFAULT_ORIGIN_WINDOW_MS).toBe(10 * 60_000);
  });
  it('ORIGIN_SIG_VERSION is the namespaced version string', () => {
    expect(ORIGIN_SIG_VERSION).toBe('onderling/origin.v1');
  });
});
