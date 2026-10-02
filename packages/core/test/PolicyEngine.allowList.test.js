/**
 * The engine's allow-list (`isAllowed`, fixed at construction like `isRevoked`): after every other check passes, a token
 * the allow-list does not accept — or one whose check throws — is refused. A revocation list stops only what it has
 * heard of; the allow-list asks whether the token is one of ours, now.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { TrustRegistry } from '../src/permissions/TrustRegistry.js';
import { PolicyEngine } from '../src/permissions/PolicyEngine.js';
import { CapabilityToken } from '../src/permissions/CapabilityToken.js';
import { SkillRegistry } from '../src/skills/SkillRegistry.js';

describe('the allow-list', () => {
  it('allowed passes; not allowed, or a check that throws, is refused', async () => {
    const me = await AgentIdentity.generate(new VaultMemory());
    const view = await AgentIdentity.generate(new VaultMemory());
    const skills = new SkillRegistry();
    skills.register('lists.addToList', async () => ({ ok: true }), { visibility: 'authenticated', policy: 'requires-token' });
    const trust = new TrustRegistry(new VaultMemory());
    await trust.setTier(me.pubKey, 'trusted');
    const token = (await CapabilityToken.issue(me, { subject: view.pubKey, agentId: me.pubKey, skill: 'lists.addToList' })).toJSON();
    const engine = (isAllowed) => new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: me.pubKey, isAllowed });
    const check = (pe) => pe.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token });
    await expect(check(engine(async () => true))).resolves.toBeTruthy();
    await expect(check(engine(async () => false))).rejects.toThrow(/not active/);
    await expect(check(engine(async () => { throw new Error('lane unreadable'); }))).rejects.toThrow(/not active/);
    await expect(check(new PolicyEngine({ trustRegistry: trust, skillRegistry: skills, agentPubKey: me.pubKey }))).resolves.toBeTruthy();
  });
});
