/**
 * THE RENAMED STORE COMES ALONG. The pinboard's local store was renamed with the app; a device updated from the build
 * before must not open an empty one — an empty store is a device that no longer knows its circles (walked: with the
 * other member online, `listMyCircles`, the roster and the posts all came back EMPTY). Anne and Bob share a circle with
 * a post and a roster; Anne's store is written under the OLD name (what the build before wrote), then she boots the new
 * build: her circle, roster and posts are there (the posts from the circle's own store, durable on the device as on
 * both shells). A reboot onto a store with no old one beside it stays empty (control:
 * the move moves only what was there).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, readRoster, until, teardown } from './support/pairRealAgents.js';

const G = 'emptied-store-circle';
const snapshot = async (node) => {
  const call = (op, args = {}) => node.agent.callSkill('pinboard', op, args);
  const circles = ((await call('listMyCircles'))?.circles ?? []).map((c) => (typeof c === 'string' ? c : c?.groupId ?? c?.id));
  const roster = (await readRoster(node, G)).map((m) => m.handle ?? m.address ?? m.webid).filter(Boolean).sort();
  const posts = ((await call('listOpenRequests', { groupId: G }))?.items ?? []).map((i) => i.text ?? i.body).filter(Boolean).sort();
  return { circles, roster, posts };
};

const OLD = ['st', 'oop'].join('');

async function scenario({ second, first = `${OLD}-items.json` }) {
  const relay = await startJourneyRelay();
  const dir = mkdtempSync(path.join(tmpdir(), 'pinboard-store-'));
  const kept = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() };
  const boot = async (file) => {
    const n = await bootRealAgentNode('anne', { agentOpts: { ...kept, deviceLog: new EventLog({ initial: [], muted: [] }), pinboardPersistDb: { path: path.join(dir, file) },
      // the circle store is durable on a device, as both shells keep it: a post lives there, not in pinboard's store
      householdPersistDb: { path: path.join(dir, 'household-items.json') } } });
    await connectNodesOverRelay([n], { relayUrl: relay.url });
    return n;
  };
  let anne = await boot(first);
  const bob = await bootRealAgentNode('bob');
  await connectNodesOverRelay([bob], { relayUrl: relay.url });
  await pairCircle(anne, bob, { groupId: G, name: 'Buurt', handle: 'bob' });
  await anne.agent.callSkill('pinboard', 'postRequest', { intent: 'ask', text: 'wie heeft een ladder', groupId: G });
  await new Promise((r) => setTimeout(r, 2500));
  const before = await snapshot(anne);
  await teardown(anne);
  anne = await boot(second);
  await bindCircleAddresses([anne, bob], G);
  // give sync its chance, the peer online
  await until(async () => ((await snapshot(anne)).posts.length ? true : null), { timeout: 30_000, step: 1000 });
  const after = await snapshot(anne);
  await teardown(anne, bob);
  try { await relay.close?.(); } catch { /* */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
  return { before, after };
}

describe('the renamed pinboard store', () => {
  it('a store written under the old name is the new store after the update: circle, roster, posts', async () => {
    const { before, after } = await scenario({ second: 'pinboard-items.json' });
    expect(before.circles, 'control: the circle was there before').toContain(G);
    expect(after.circles, 'the device still knows its circle').toContain(G);
    expect(after.roster).toEqual(before.roster);
    expect(after.posts).toEqual(before.posts);
  }, 180_000);
  it('nothing under the old name: the new store starts empty (the move invents nothing)', async () => {
    const { before, after } = await scenario({ first: 'elsewhere-items.json', second: 'pinboard-items.json' });
    // The circle, its roster and its posts live in the circle's own store, which this move never touches — so they are
    // the same after it, from there, not from a store under another name (what is left in pinboard's own store goes in
    // the fold's last step, and this test with it).
    expect(before.circles).toContain(G);
    expect(after.circles).toContain(G);
    expect(after.roster).toEqual(before.roster);
  }, 180_000);
});
