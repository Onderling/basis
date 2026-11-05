/**
 * A wire caller this agent has no record of, and that the host does not know, is a STRANGER: 'public'. 'authenticated'
 * meant "a key signed this", and every stranger has a key. With an `isKnown(peer)` predicate injected (the host's own
 * devices, circle rosters and contact book, computed at call time) a known peer keeps the registry default.
 * A presented token is judged FIRST: a valid one is the record; a failing one is refused there, never sent on to the
 * tier. Without `isKnown` the engine keeps today's default, so a host that has not opted in is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { TrustRegistry } from '../src/permissions/TrustRegistry.js';
import { PolicyEngine } from '../src/permissions/PolicyEngine.js';
import { CapabilityToken } from '../src/permissions/CapabilityToken.js';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';

async function setup(opts = {}) {
  const me = await AgentIdentity.generate(new VaultMemory());
  const caller = await AgentIdentity.generate(new VaultMemory());
  const skills = new SkillRegistry();
  skills.register('reachable-peers', async () => [], { visibility: 'authenticated', policy: 'on-request' });
  skills.register('lists.addToList', async () => ({ ok: true }), { visibility: 'authenticated', policy: 'requires-token' });
  skills.register('hello', async () => 'hi', { visibility: 'public', policy: 'on-request' });
  const trust = new TrustRegistry(new VaultMemory());
  await trust.setTier(me.pubKey, 'trusted');   // the token issuer
  const engine = new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: me.pubKey, ...opts });
  const token = (await CapabilityToken.issue(me, { subject: caller.pubKey, agentId: me.pubKey, skill: 'lists.addToList' })).toJSON();
  return { engine, me, caller, token };
}

describe('PolicyEngine: a stranger on the wire', () => {
  it('with isKnown injected, an unknown caller is public: an authenticated skill refuses with a reason', async () => {
    const { engine, caller } = await setup({ isKnown: async () => false });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'reachable-peers' }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'hello' })).resolves.toMatchObject({ tier: 'public' });
  });

  it('a known caller keeps the default', async () => {
    const { engine, caller } = await setup({ isKnown: async (k) => k !== 'nobody' });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'reachable-peers' })).resolves.toMatchObject({ tier: 'authenticated' });
  });

  it('a valid token is the record: an unknown token holder reaches its op', async () => {
    const { engine, caller, token } = await setup({ isKnown: async () => false });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'lists.addToList', token })).resolves.toBeTruthy();
  });

  it('a failing token is refused at the token, never sent on to the tier', async () => {
    const { engine, caller, token } = await setup({ isKnown: async () => true, isRevoked: async () => true });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'lists.addToList', token }))
      .rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('no token on a token op: refused with its reason, known or not', async () => {
    const { engine, caller } = await setup({ isKnown: async () => true });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'lists.addToList' })).rejects.toMatchObject({ code: 'NO_TOKEN' });
  });

  it('without isKnown nothing changes: an unrecorded peer is authenticated, as before', async () => {
    const { engine, caller } = await setup();
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'reachable-peers' })).resolves.toMatchObject({ tier: 'authenticated' });
  });

  it('isKnown that throws counts as unknown', async () => {
    const { engine, caller } = await setup({ isKnown: async () => { throw new Error('roster down'); } });
    await expect(engine.checkInbound({ peerPubKey: caller.pubKey, skillId: 'reachable-peers' })).rejects.toMatchObject({ code: 'INSUFFICIENT_TIER' });
  });
});
