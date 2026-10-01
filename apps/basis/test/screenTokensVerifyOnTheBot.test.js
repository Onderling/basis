/**
 * A token the bot mints for a screen verifies at the bot's own door, with no `setTier` in the test. The kernel's door
 * needs a token's issuer at `trusted`; the agent raises its own chat key (and only it) at boot, the kernel's documented
 * enablement step. Composed as the box composes a bot (door levels and roles), minted through the bot's own
 * `grantSurface` as the `/scherm` flow does. Someone else's key, issuing the same token, is still refused.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs, VaultMemory } from '@onderling/vault';
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';

const t = (k) => k;

describe('the bot\'s own screen tokens verify at its door', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('minted by grantSurface, checked by the kernel door; no setTier in the test', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-own-tokens-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
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
  }, 120_000);
});
