/**
 * A PERSON GRANTS ANOTHER AGENT A PLACE ON THEIR COMPANION — from their app, over a real relay, the real agent, the
 * real node.
 *
 * Having claimed the node, the person asks it what it can let another agent do (its families, the tick list) and
 * grants one to an agent's key: the app signs `grants.mint` with THIS device's delegation key; the node mints one
 * token per op to that key and delivers them over the relay. A node the person does not own is not asked; a family
 * the node does not know is refused by the node.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Agent, AgentIdentity, CapabilityToken, Parts } from '@onderling/core';
import { randomKey, sealForLink } from '@onderling/blob-gateway';
import { VaultMemory } from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { startJourneyRelay } from './support/testRelay.js';
import { pendingRevokesOf } from '@onderling/agent-registry';
import { bootRealAgentNode, connectNodesOverRelay, teardown, until } from './support/pairRealAgents.js';
import { startCompanionNode } from '../../companion-node/src/index.js';
import { COMPANION_GRANT_SUBTYPE } from '../src/v2/companionGrant.js';

describe('a person grants an agent a place on their companion', () => {
  let relay; let host; let web; let dir; let bot; const got = [];
  beforeAll(async () => {
    relay = await startJourneyRelay();
    dir = mkdtempSync(path.join(tmpdir(), 'basis-companion-grant-'));
    host = await startCompanionNode({ relayUrl: relay.url, configDir: dir, management: true, feeds: true });
    web = await bootRealAgentNode('web', {});
    await connectNodesOverRelay([web], { relayUrl: relay.url });
    // the agent to be granted: any agent on the relay, keeping what reaches it
    const id = await AgentIdentity.generate(new VaultMemory());
    bot = new Agent({ identity: id, transport: new RelayTransport({ relayUrl: relay.url, identity: id }), label: 'bot' });
    bot.on('message', (m) => { if (m?.payload?.subtype === COMPANION_GRANT_SUBTYPE) got.push(m); });
    await bot.start();
  }, 60_000);
  afterAll(async () => {
    try { await bot?.stop(); } catch { /* */ }
    try { await teardown([web]); } catch { /* */ }
    try { await host?.stop(); } catch { /* */ }
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  it('a node not yet the person\'s is not asked; once claimed, its choices come from it and the grant reaches the agent', async () => {
    const node = host.agent.address;
    const call = (op, args) => web.agent.callSkill('household', op, args);
    expect(await call('companionGrantChoices', { node }), 'not owned yet').toMatchObject({ ok: false, outcome: 'not-owned' });
    expect(await call('grantCompanion', { node, to: bot.pubKey, families: ['agenda-files'] })).toMatchObject({ ok: false, outcome: 'not-owned' });
    expect(got).toEqual([]);

    expect(await call('claimCompanion', { claim: host.claimString() })).toMatchObject({ ok: true });
    expect(await call('companionGrantChoices', { node })).toEqual({ ok: true, outcome: 'ok', families: ['agenda-files'] });
    expect(await call('grantCompanion', { node, to: bot.pubKey, families: ['*'] }), 'the node refuses a family it does not know').toMatchObject({ ok: false, outcome: 'unknown-family' });
    expect(await call('grantCompanion', { node, to: bot.pubKey }), 'nothing ticked').toMatchObject({ ok: false, outcome: 'bad-args' });

    const r = await call('grantCompanion', { node, to: bot.pubKey, families: ['agenda-files'] });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, outcome: 'ok', ops: ['feed.drop', 'feed.put'] });
    const msg = await until(async () => got[0] ?? null, { timeout: 15_000, step: 100 });
    expect(msg?.from).toBe(node);
    const tokens = msg.payload.tokens.map((t) => CapabilityToken.fromJSON(t));
    expect(tokens.map((t) => t.skill).sort()).toEqual(['feed.drop', 'feed.put']);
    for (const t of tokens) { expect(t.issuer).toBe(node); expect(t.subject).toBe(bot.pubKey); }
  }, 90_000);

  it('the person sees who holds what on their node, and revokes it: the agent\'s next call is refused', async () => {
    const node = host.agent.address;
    const call = (op, args) => web.agent.callSkill('household', op, args);
    // (the claim and the grant of the test above stand)
    expect(await call('companionGrantList', { node })).toEqual({ ok: true, outcome: 'ok', grants: [{ to: bot.pubKey, families: ['agenda-files'] }] });
    expect(await call('companionGrantList', { node: 'X'.repeat(43) })).toMatchObject({ ok: false, outcome: 'not-owned' });
    await bot.hello(node);
    const tokens = got[got.length - 1].payload.tokens;
    const put = tokens.find((t) => t.skill === 'feed.put');
    const file = { id: randomKey(), envelope: sealForLink('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', randomKey()) };
    expect(Parts.data(await bot.invoke(node, 'feed.put', file, { token: put }))).toEqual({ ok: true });

    expect(await call('revokeCompanionGrant', { node, to: bot.pubKey })).toMatchObject({ ok: true, outcome: 'ok', revoked: 2 });
    await expect(bot.invoke(node, 'feed.put', file, { token: put })).rejects.toThrow(/revoked/i);
    expect(await call('companionGrantList', { node })).toMatchObject({ ok: true, grants: [] });
    // without a node (a contact deleted): owed to every node the person owns, told in the background — never waited on
    expect(await call('revokeCompanionGrant', { to: bot.pubKey })).toMatchObject({ ok: true, outcome: 'pending', pending: 1 });
    const owed = async () => pendingRevokesOf({ properties: (await web.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {} });
    expect(await until(async () => ((await owed()).length === 0 ? true : null), { timeout: 20_000, step: 200 }), 'told, and no longer owed').toBe(true);
    expect(await call('revokeCompanionGrant', { node })).toMatchObject({ ok: false, outcome: 'bad-args' });
  }, 90_000);

  it('a revoke owed to a node that is away never waits: it is kept, and lands when the node answers again', async () => {
    const node = host.agent.address;
    const call = (op, args) => web.agent.callSkill('household', op, args);
    const before = got.length;
    expect(await call('grantCompanion', { node, to: bot.pubKey, families: ['agenda-files'] })).toMatchObject({ ok: true });
    const put = (await until(async () => got[before] ?? null, { timeout: 15_000, step: 100 })).payload.tokens.find((t) => t.skill === 'feed.put');
    await host.stop();

    // the node is away: the revoke (a contact deleted) answers at once, and the debt is on the person's own record
    const t0 = Date.now();
    expect(await call('revokeCompanionGrant', { to: bot.pubKey })).toMatchObject({ ok: true, outcome: 'pending', pending: 1 });
    expect(Date.now() - t0, 'it did not wait on the node').toBeLessThan(3_000);
    const owed = async () => pendingRevokesOf({ properties: (await web.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {} });
    expect(await owed()).toEqual([{ node, key: bot.pubKey }]);
    // a retry while it is still away keeps it owed
    await web.agent.retryPendingCompanionRevokes();
    expect(await owed()).toEqual([{ node, key: bot.pubKey }]);

    // the node comes back; the next time it answers, what it is owed lands
    host = await startCompanionNode({ relayUrl: relay.url, configDir: dir, management: true, feeds: true });
    expect(host.agent.address).toBe(node);
    const tries = [];
    const back = await until(async () => { const r = await call('companionGrantList', { node }); tries.push(r?.outcome); return r?.ok ? r : null; }, { timeout: 60_000, step: 500 });
    expect(back, `the node answers again (${tries.join(',')})`).toBeTruthy();
    expect(await until(async () => ((await owed()).length === 0 ? true : null), { timeout: 20_000, step: 200 }), 'the owed revoke landed').toBe(true);
    // the node's own gate now refuses that token
    await expect(host.agent.policyEngine.checkInbound({ peerPubKey: bot.pubKey, skillId: 'feed.put', token: put, agentPubKey: node })).rejects.toThrow(/revoked/i);
    expect(await call('companionGrantList', { node })).toMatchObject({ ok: true, grants: [] });
  }, 120_000);
});
