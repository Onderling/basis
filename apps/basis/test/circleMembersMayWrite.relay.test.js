/**
 * "PEOPLE IN MY CIRCLES MAY WRITE TO ME" (Frits 2026-11-12): a per-persona setting, default ON. With it on, a member of
 * one of THAT persona's circles (seen on this device's own roster, never on their say-so) who writes privately gets a
 * THREAD, but NO contact row: they become a contact when the person answers (answering is choosing). With it off, their
 * first private message is a request like anyone's. Circles of another persona do not count.
 *
 * And the delivery receipt (Frits 2026-11-11, kept = accepted): a member who wrote first is KNOWN, not KEPT, so their
 * turn gets no receipt until the person answers; after that it does. The receipt is read where the channel decides it
 * (its landed hook, which the shells point at the receipt sender).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, pairCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';

const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const bookOf = async (node) => ((await node.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? []).map((c) => c.webid);
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);
const CIRCLE = 'buren';

describe('people in my circles may write to me', () => {
  let relay; let me; let ann; let bob; let B;
  const receipts = [];

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    me = await bootRealAgentNode('me', opts());
    ann = await bootRealAgentNode('ann', opts());
    bob = await bootRealAgentNode('bob', opts());
    await connectNodesOverRelay([me, ann, bob], { relayUrl: relay.url });
    await pairCircle(me, ann, { groupId: CIRCLE, name: 'Buren' });
    await joinExistingCircle(me, bob, { groupId: CIRCLE, handle: 'bobby' });
    await bindCircleAddresses([me, ann, bob], CIRCLE);
    B = me.agent.persona((await me.agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id);
    me.contactThreadChannel.setLandedHook((r) => { receipts.push(r.msgId); });
  }, 180_000);
  afterAll(async () => { await teardown(me, ann, bob); await relay?.close?.(); });

  it('on (the default): a circle member writing privately gets a thread, and no contact row', async () => {
    await ann.contactThreadChannel.sendTurn({ peerAddr: me.pubKey, text: 'hoi buur', messageId: 'ann-1' });
    expect(await until(async () => ((await threadOf(me, ann.pubKey)).some((t) => t.text === 'hoi buur') ? true : null), { timeout: 20_000, step: 200 }),
      `not on the thread; requests ${JSON.stringify((await requestsOf(me)).map((q) => q.from))}`).toBe(true);
    await new Promise((r) => { setTimeout(r, 1500); });
    expect(await requestsOf(me)).toEqual([]);
    expect(await bookOf(me), 'a circle member became a contact before the person answered').not.toContain(ann.pubKey);
    expect(receipts, 'a member the person has not answered got a receipt').not.toContain('ann-1');
  }, 40_000);

  it('the person answers: then the member is a contact', async () => {
    await me.contactThreadChannel.sendTurn({ peerAddr: ann.pubKey, text: 'hoi Ann', messageId: 'me-1' });
    expect(await until(async () => ((await bookOf(me)).includes(ann.pubKey) ? true : null), { timeout: 20_000, step: 200 }),
      'answering did not make the member a contact').toBe(true);
    await ann.contactThreadChannel.sendTurn({ peerAddr: me.pubKey, text: 'fijn', messageId: 'ann-2' });
    expect(await until(async () => (receipts.includes('ann-2') ? true : null), { timeout: 20_000, step: 200 }),
      `a kept contact got no receipt; ${JSON.stringify(receipts)}`).toBe(true);
  }, 40_000);

  it('a circle of the general persona does not open another persona\'s door', async () => {
    expect(await me.agent.messageRequests.isMember({ contactId: bob.pubKey, fromAddr: bob.pubKey, to: me.pubKey })).toBe(true);
    expect(await me.agent.messageRequests.isMember({ contactId: bob.pubKey, fromAddr: bob.pubKey, to: B.chatId.pubKey })).toBe(false);
  }, 20_000);

  it('off: a circle member\'s first private message is a request', async () => {
    expect(await me.agent.setCircleMembersMayWrite(false)).toBe(false);
    await bob.contactThreadChannel.sendTurn({ peerAddr: me.pubKey, text: 'hallo', messageId: 'bob-1' });
    expect(await until(async () => ((await requestsOf(me)).some((q) => q.from === bob.pubKey) ? true : null), { timeout: 20_000, step: 200 })).toBe(true);
    expect((await threadOf(me, bob.pubKey)).map((t) => t.text)).toEqual([]);
  }, 40_000);
});
