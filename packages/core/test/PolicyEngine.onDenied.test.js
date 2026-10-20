/**
 * A presented token that is refused says so to whoever asked to hear it (`onDenied`): the code, a short reason, and
 * the skill — never the token. A screen's "Token has been revoked" was otherwise invisible to the box's logs (L196): the
 * refusal went back to the screen and nowhere else. A hook that throws never changes the refusal.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { TrustRegistry } from '../src/permissions/TrustRegistry.js';
import { PolicyEngine } from '../src/permissions/PolicyEngine.js';
import { CapabilityToken } from '../src/permissions/CapabilityToken.js';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';

describe('PolicyEngine onDenied', () => {
  it('names the reason of a refused token: revoked · not-active · check-failed — and the skill, never the token', async () => {
    const me = await AgentIdentity.generate(new VaultMemory());
    const view = await AgentIdentity.generate(new VaultMemory());
    const skills = new SkillRegistry();
    skills.register('lists.addToList', async () => ({ ok: true }), { visibility: 'authenticated', policy: 'requires-token' });
    const trust = new TrustRegistry(new VaultMemory());
    await trust.setTier(me.pubKey, 'trusted');
    const token = (await CapabilityToken.issue(me, { subject: view.pubKey, agentId: me.pubKey, skill: 'lists.addToList' })).toJSON();
    const heard = [];
    const engine = (o) => new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: me.pubKey, onDenied: (d) => heard.push(d), ...o });
    const check = (pe) => pe.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token });
    await expect(check(engine({ isRevoked: async () => true }))).rejects.toThrow(/revoked/);
    await expect(check(engine({ isAllowed: async () => false }))).rejects.toThrow(/not active/);
    await expect(check(engine({ isRevoked: async () => { throw new Error('x'); } }))).rejects.toThrow(/check failed/);
    expect(heard).toEqual([
      { code: 'INVALID_TOKEN', reason: 'revoked', skillId: 'lists.addToList' },
      { code: 'INVALID_TOKEN', reason: 'not-active', skillId: 'lists.addToList' },
      { code: 'INVALID_TOKEN', reason: 'check-failed', skillId: 'lists.addToList' },
    ]);
    expect(JSON.stringify(heard)).not.toContain(token.id ?? '@@');
  });
  it('a hook that throws changes nothing; an allowed token is not reported', async () => {
    const me = await AgentIdentity.generate(new VaultMemory());
    const view = await AgentIdentity.generate(new VaultMemory());
    const skills = new SkillRegistry();
    skills.register('lists.addToList', async () => ({ ok: true }), { visibility: 'authenticated', policy: 'requires-token' });
    const trust = new TrustRegistry(new VaultMemory());
    await trust.setTier(me.pubKey, 'trusted');
    const token = (await CapabilityToken.issue(me, { subject: view.pubKey, agentId: me.pubKey, skill: 'lists.addToList' })).toJSON();
    let calls = 0;
    const boom = new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: me.pubKey, isRevoked: async () => true, onDenied: () => { calls += 1; throw new Error('log down'); } });
    await expect(boom.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token })).rejects.toThrow(/revoked/);
    const ok = new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: me.pubKey, onDenied: () => { calls += 10; } });
    await expect(ok.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token })).resolves.toBeTruthy();
    expect(calls).toBe(1);
  });
});
