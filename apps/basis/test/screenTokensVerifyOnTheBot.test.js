/**
 * A token the bot mints for a screen verifies at the bot's own door, with no `setTier` in the test. The kernel's door
 * needs a token's issuer at `trusted`; a bot's composition (`trustOwnGrants`, as the box passes it) raises its own chat
 * key, and only it, at boot — the kernel's documented enablement step. A person's agent too, now that its door
 * ALLOWS only surface tokens active on the grants lane: a token signed off the record with the agent's key is refused.
 * Composed as the box composes a bot (door levels and roles), minted through the bot's own
 * `grantSurface` as the `/scherm` flow does. Someone else's key, issuing the same token, is still refused.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs, VaultMemory } from '@onderling/vault';
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';

const t = (k) => k;

describe('the bot\'s own screen tokens verify at its door', () => {
  let dir; let agent; let personAgent;
  afterAll(async () => { for (const a of [agent, personAgent]) await a?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });
  const boot = async (sub, extra) => {
    const d = path.join(dir, sub);
    const pass = randomBytes(32).toString('base64url');
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, 'vault.passphrase'), pass, { mode: 0o600 });
    return createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(d, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(d, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(d, 'household-items.json') }, seedDemoData: false, seedHousehold: false, t, ...extra,
    });
  };

  it('minted by grantSurface, checked by the kernel door; no setTier in the test', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-own-tokens-'));
    agent = await boot('bot', { tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, trustOwnGrants: true });
    await agent.surfaceGrantsReady();
    const bot = agent.sa.agent;
    bot.skills.register('lists.addToList', async () => ({ ok: true }), { visibility: 'authenticated', policy: 'requires-token' });
    const view = await AgentIdentity.generate(new VaultMemory());
    const r = await agent.callSkill('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['lists.addToList'], actingAs: 'telegram:1', label: 'scherm' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [token] = r.tokens;
    expect(token.constraints.actingAs).toBe('telegram:1');
    await expect(bot.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token })).resolves.toBeTruthy();

    // the same token issued by any other key: refused (only the bot's own key counts as its issuer)
    const other = await AgentIdentity.generate(new VaultMemory());
    const forged = (await CapabilityToken.issue(other, { subject: view.pubKey, agentId: bot.identity.pubKey, skill: 'lists.addToList', constraints: { role: 'surface', actingAs: 'telegram:1' } })).toJSON();
    await expect(bot.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token: forged })).rejects.toThrow(/not trusted/);

    // a person's agent: its own RECORDED grant verifies at its door (the door allows only surface tokens active on the
    // grants lane); a surface token signed with the same key OFF the record (as a revoked device could) is refused
    personAgent = await boot('person', {});
    await personAgent.surfaceGrantsReady();
    const own = personAgent.sa.agent;
    own.skills.register('lists.addToList', async () => ({ ok: true }), { visibility: 'authenticated', policy: 'requires-token' });
    const g = await personAgent.callSkill('household', 'grantSurface', { viewPubKey: view.pubKey, ops: ['lists.addToList'] });
    await expect(own.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token: g.tokens[0] })).resolves.toBeTruthy();
    const offRecord = (await CapabilityToken.issue(own.identity, { subject: view.pubKey, agentId: own.identity.pubKey, skill: 'lists.addToList', constraints: { role: 'surface' } })).toJSON();
    await expect(own.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token: offRecord })).rejects.toThrow(/not active/);
    // the attacker writes the token: an off-record token signed with the agent's own key is refused whatever it says
    // it is — no role, another role, a wildcard skill — on a person's agent and on the bot
    for (const [agentLabel, ag] of [['person', own], ['bot', bot]]) {
      for (const [label, extra] of [['no role', {}], ['role member', { constraints: { role: 'member' } }], ['wildcard skill', { skill: '*' }]]) {
        const forged = (await CapabilityToken.issue(ag.identity, { subject: view.pubKey, agentId: ag.identity.pubKey, skill: 'lists.addToList', ...extra })).toJSON();
        await expect(ag.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token: forged }), `${agentLabel}: ${label}`).rejects.toThrow(/not active/);
      }
    }
    // a recorded grant for ANOTHER subject does not make this one active either
    const otherView = await AgentIdentity.generate(new VaultMemory());
    const g2 = await personAgent.callSkill('household', 'grantSurface', { viewPubKey: otherView.pubKey, ops: ['lists.addToList'] });
    const stolen = g2.tokens[0];
    await expect(own.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token: stolen })).rejects.toThrow();
    // the bot's off-record surface token too
    const botOff = (await CapabilityToken.issue(bot.identity, { subject: view.pubKey, agentId: bot.identity.pubKey, skill: 'lists.addToList', constraints: { role: 'surface', actingAs: 'telegram:1' } })).toJSON();
    await expect(bot.policyEngine.checkInbound({ peerPubKey: view.pubKey, skillId: 'lists.addToList', token: botOff })).rejects.toThrow(/not active/);
  }, 120_000);
});
