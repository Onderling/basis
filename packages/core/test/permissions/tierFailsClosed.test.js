/**
 * Fitness — an unrecognised tier fails CLOSED, in both directions.
 *
 * `PolicyEngine` resolved both sides of the gate with `?? 1` (`authenticated`). That is the wrong default
 * for each, and wrong in the dangerous direction for one of them: a skill whose `visibility` the engine did
 * not recognise became reachable by any known peer. Silently — nothing logs, nothing throws, the skill just
 * answers.
 *
 * `defineSkill` validates visibility against the same four tiers, so a registry built through it cannot
 * contain an unknown one. But `PolicyEngine` accepts a registry from anywhere — a test, a future host, a
 * typo in a migration — and a gate should not depend on someone else having validated its input.
 *
 * The two defaults are deliberately OPPOSITE: an unknown CALLER gets the least (we do not know who they
 * are); an unknown SKILL is guarded most (we do not know what it protects).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { PolicyEngine } from '../../src/permissions/PolicyEngine.js';
import { TrustRegistry, TIER_LEVEL } from '../../src/permissions/TrustRegistry.js';
import { VaultMemory } from '@onderling/vault';
import { defineSkill } from '../../src/skills/defineSkill.js';
import { CapabilityToken } from '../../src/permissions/CapabilityToken.js';

const engineWith = async (skillRegistry, callerTier) => {
  const owner = await AgentIdentity.generate(new VaultMemory());
  const caller = await AgentIdentity.generate(new VaultMemory());
  const trust = new TrustRegistry(new VaultMemory());
  if (callerTier) await trust.setTier(caller.pubKey, callerTier);
  return {
    caller,
    engine: new PolicyEngine({ trustRegistry: trust, agentPubKey: owner.pubKey, skillRegistry }),
  };
};
const skill = (visibility) => ({ enabled: true, visibility, policy: 'on-request' });

describe('an unknown SKILL visibility is guarded MOST', () => {
  it('a made-up tier is not reachable by an ordinary caller', async () => {
    const { caller, engine } = await engineWith(new Map([['op', skill('household')]]), 'authenticated');
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'op' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });

  it('…not even by a TRUSTED caller — unknown means private, the highest bar', async () => {
    const { caller, engine } = await engineWith(new Map([['op', skill('typo-here')]]), 'trusted');
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'op' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });

  it('a KNOWN tier is unaffected — the change must not lock out normal skills', async () => {
    // The control. Failing closed is only useful if it does not also close what should be open.
    const { caller, engine } = await engineWith(new Map([['op', skill('authenticated')]]), 'authenticated');
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'op' }))
      .resolves.toMatchObject({ allowed: true });
  });
});

describe('an unknown CALLER tier gets the LEAST', () => {
  it('a caller with a nonsense tier reaches only `public` skills', async () => {
    const { caller, engine } = await engineWith(new Map([
      ['pub', skill('public')],
      ['auth', skill('authenticated')],
    ]), 'not-a-real-tier');

    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'pub' }))
      .resolves.toMatchObject({ allowed: true });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'auth' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });
});

describe('the two defaults are opposite ends, on purpose', () => {
  it('public is the floor and private the ceiling', () => {
    expect(TIER_LEVEL.public).toBe(Math.min(...Object.values(TIER_LEVEL)));
    expect(TIER_LEVEL.private).toBe(Math.max(...Object.values(TIER_LEVEL)));
  });

  it('`defineSkill` still refuses an unknown visibility at the source', () => {
    // Belt and braces: the gate now fails closed, AND a skill cannot be DECLARED with a tier that would
    // trip it. If this ever stops throwing, the gate above is the only thing left.
    expect(() => defineSkill('x', async () => ({}), { visibility: 'household' }))
      .toThrow(/unknown visibility tier/);
  });
});

/**
 * The same rule, one layer in: a revocation check that THROWS counts as revoked.
 *
 * The issuer-side revocation list is the thing that catches "I revoked this token" even when the holder
 * still has the blob. Its failure was swallowed into `revoked = false`, so an unreachable or broken
 * revocation source admitted exactly the tokens it existed to stop — silently, and precisely when the
 * source is having a bad day. Deny wins.
 */
describe('a revocation check that fails counts as REVOKED', () => {
  const engineWithRevocation = async (isRevoked) => {
    const owner  = await AgentIdentity.generate(new VaultMemory());
    const caller = await AgentIdentity.generate(new VaultMemory());
    const trust  = new TrustRegistry(new VaultMemory());
    await trust.setTier(caller.pubKey, 'trusted');   // the caller clears the skill's bar
    await trust.setTier(owner.pubKey,  'trusted');   // …and the token's issuer is trusted
    const engine = new PolicyEngine({
      trustRegistry: trust,
      agentPubKey:   owner.pubKey,
      skillRegistry: new Map([['op', { enabled: true, visibility: 'authenticated', policy: 'requires-token' }]]),
      isRevoked,
    });
    const token = await CapabilityToken.issue(owner, {
      subject: caller.pubKey, agentId: owner.pubKey, skill: 'op', expiresIn: 60_000,
    });
    return { caller, engine, token: token.toJSON() };
  };

  it('admits the call when the check answers cleanly', async () => {
    const { caller, engine, token } = await engineWithRevocation(async () => false);
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'op', token }))
      .resolves.toMatchObject({ allowed: true });
  });

  it('DENIES when the check throws — a broken revocation source must not admit tokens', async () => {
    const { caller, engine, token } = await engineWithRevocation(async () => {
      throw new Error('revocation store unreachable');
    });
    await expect(
      engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'op', token }),
      'a throwing revocation check admitted the token it was guarding',
    ).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('still denies a plainly revoked token', async () => {
    const { caller, engine, token } = await engineWithRevocation(async () => true);
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'op', token }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});
