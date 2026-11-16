/**
 * A BLOCK IS ABOUT DIRECT CONTACT, NEVER A CIRCLE (Frits 2026-11-12, after comparing Signal, WhatsApp and Telegram, which
 * all keep a block one-on-one). The block list stays (alias-aware: every address the person had); where it is CHECKED
 * moved: the direct doors (the contact channel, files, threaded answers) refuse a blocked person before anything else,
 * and my own direct send to them is refused; circle traffic never looks at it, so each member's device keeps the same
 * view of the circle. Before this, the secure agent dropped everything from the person and refused every send to them,
 * circle traffic included: a silent half-removal on one device.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown, addCardOf } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../src/v2/householdRosterPairing.js';

const C = 'straat';
const postsOf = async (node) => ((await node.agent.callSkill('pinboard', 'listOpenRequests', {}))?.items ?? []).map((i) => i.text ?? i.body);
const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);

describe('a block is about direct contact, never a circle', () => {
  let relay; let me; let ann;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    [me, ann] = await Promise.all([
      bootRealAgentNode('me', { itemsLane: true, contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } }),
      bootRealAgentNode('ann', { itemsLane: true, contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } }),
    ]);
    await connectNodesOverRelay([me, ann], { relayUrl: relay.url });
    await createCircle(me, { groupId: C, name: 'Straat' });
    await joinExistingCircle(me, ann, { groupId: C, handle: 'ann' });
    for (const n of [me, ann]) { await bindCircleAddresses([n], C); await bindCircleAddressKeysFor({ agent: n.agent, circleId: C }); }
    me.agent.circleStoreFor(C); ann.agent.circleStoreFor(C);   // the circle open on both screens, as a shell opens it
    expect(await me.agent.sa.mute.add(ann.pubKey, { label: 'Ann' })).toBe(true);
  }, 180_000);
  afterAll(async () => { await teardown(me, ann); await relay?.close?.(); });

  it('her circle post still reaches me', async () => {
    await ann.agent.callSkill('pinboard', 'postRequest', { intent: 'ask', text: 'wie heeft een ladder?', groupId: C });
    expect(await until(async () => ((await postsOf(me)).includes('wie heeft een ladder?') ? true : null), { timeout: 20_000, step: 300 }),
      'a block cut the circle: her post never reached me').toBe(true);
  }, 40_000);

  it('my circle post still reaches her', async () => {
    await me.agent.callSkill('pinboard', 'postRequest', { intent: 'offer', text: 'ik heb een ladder', groupId: C });
    expect(await until(async () => ((await postsOf(ann)).includes('ik heb een ladder') ? true : null), { timeout: 20_000, step: 300 }),
      'a block cut the circle: my post never reached her').toBe(true);
  }, 40_000);

  it('her direct message leaves nothing: no request, no thread', async () => {
    await addCardOf(ann, me);   // she holds my card (blocking me does not take it from her)
    await ann.contactThreadChannel.sendTurn({ peerAddr: me.pubKey, text: 'hoi', messageId: 'ann-dm-1' });
    await new Promise((r) => { setTimeout(r, 3000); });
    expect((await requestsOf(me)).map((q) => q.from)).not.toContain(ann.pubKey);
    expect((await threadOf(me, ann.pubKey)).map((t) => t.text)).toEqual([]);
  }, 30_000);

  it('my OTHER direct sends to her are refused at the agent (a file, a receipt), and circle traffic is not', async () => {
    const file = await me.agent.sendPeerMessage(ann.pubKey, { type: 'p2p-chat', subtype: 'file-share', file: { id: 'f1', name: 'x.txt', dataB64: 'eA==' } });
    expect(file?.refused, JSON.stringify(file)).toBe('blocked');
    const receipt = await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'delivery-receipt', messageId: 'x' });
    expect(receipt?.refused, JSON.stringify(receipt)).toBe('blocked');
    const circleish = await me.agent.sendPeerMessage(ann.pubKey, { subtype: 'circle-address-announce', groupId: C }, { circleId: C }).catch((e) => ({ error: String(e?.message ?? e) }));
    expect(circleish?.refused ?? null, 'circle traffic is never refused for a block').not.toBe('blocked');
  }, 30_000);

  it('my direct message to her is refused, with its reason', async () => {
    const r = me.contactThreadChannel.sendTurn({ peerAddr: ann.pubKey, text: 'hoi Ann', messageId: 'me-dm-1' });
    const sent = await r.sent.catch((e) => ({ error: String(e?.message ?? e) }));
    expect(sent?.refused ?? sent?.reason ?? sent?.error ?? null, JSON.stringify(sent)).toMatch(/blocked/);
    await new Promise((res) => { setTimeout(res, 2000); });
    expect((await threadOf(ann, me.pubKey)).map((t) => t.text)).not.toContain('hoi Ann');
  }, 30_000);
});
