/**
 * A PERSON CLAIMS THEIR COMPANION FROM THEIR APP — over a real relay, the real agent, the real node.
 *
 * The node prints `Claim: <code>@<address>`; the person pastes it into the app's claim ceremony; the app signs the
 * claim with THIS device's delegation key (its root-signed delegation alongside) and the node records the person's
 * OWNER ROOT. The app writes the node down as one the person owns. When the person later revokes a device, the
 * ceremony tells every node they own — the root's own tombstone — so the revoked device no longer manages it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deviceDelegationsOf, ownedNodesOf } from '@onderling/agent-registry';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, teardown } from './support/pairRealAgents.js';
import { startCompanionNode } from '../../companion-node/src/index.js';

describe('a person claims their companion from their app', () => {
  let relay; let host; let web; let dir;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    dir = mkdtempSync(path.join(tmpdir(), 'basis-companion-claim-'));
    host = await startCompanionNode({ relayUrl: relay.url, configDir: dir, management: true });
    web = await bootRealAgentNode('web', {});
    await connectNodesOverRelay([web], { relayUrl: relay.url });
  }, 60_000);
  afterAll(async () => {
    try { await teardown([web]); } catch { /* */ }
    try { await host?.stop(); } catch { /* */ }
    try { await relay?.close?.(); } catch { /* */ }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  });

  const props = async () => (await web.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};

  it('a pasted line that is not a claim is said so; the real one makes the person\'s ROOT the owner', async () => {
    expect(await web.agent.callSkill('household', 'claimCompanion', { claim: 'hallo' })).toMatchObject({ ok: false, outcome: 'bad-claim' });
    const claim = `Claim: ${host.claimString()}`;
    const r = await web.agent.callSkill('household', 'claimCompanion', { claim });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, outcome: 'ok', node: host.agent.address });
    const roots = new Set(Object.values(deviceDelegationsOf({ properties: await props() })).map((d) => d.by));
    expect(roots.has(host.managementOwnerRoot), 'the node\'s owner is the root this device\'s delegation names').toBe(true);
    expect(Object.keys(ownedNodesOf({ properties: await props() }))).toEqual([host.agent.address]);
    // a second claim: the node has its owner
    expect(await web.agent.callSkill('household', 'claimCompanion', { claim })).toMatchObject({ ok: false });
  }, 60_000);

  it('revoking a device tells every node the person owns — the root\'s tombstone lands there', async () => {
    const phrase = (await web.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect(phrase?.split(/\s+/).length).toBe(24);
    const r = await web.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'lost-phone' });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, nodesTold: 1 });
    const record = JSON.parse(readFileSync(path.join(dir, 'owner.json'), 'utf8'));
    expect(record.revoked).toContain('lost-phone');
  }, 60_000);
});
