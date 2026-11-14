/**
 * "PEOPLE IN MY CIRCLES MAY WRITE TO ME" SWITCHED OFF AFTER A MEMBER ALREADY WROTE (found walking the phone,
 * 2026-11-14): the member's first message came in as a thread while the setting was on; the person did not answer; then
 * the person switched it off and the member wrote again. That second message must land SOMEWHERE the person sees it:
 * in the member's thread (they already wrote, the door is for a first message) or as a request. Never nowhere.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';

const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);
const CIRCLE = 'straat';

describe('switched off after a member already wrote', () => {
  let relay; let me; let cas;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    const opts = () => ({ contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    me = await bootRealAgentNode('me', opts());
    cas = await bootRealAgentNode('cas', opts());
    await connectNodesOverRelay([me, cas], { relayUrl: relay.url });
    await pairCircle(me, cas, { groupId: CIRCLE, name: 'Straat' });
    await bindCircleAddresses([me, cas], CIRCLE);
  }, 180_000);
  afterAll(async () => { await teardown(me, cas); await relay?.close?.(); });

  it("the member's later message lands in their thread or as a request — never nowhere", async () => {
    await cas.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor(CIRCLE), threadId: me.pubKey, text: 'eerste', messageId: 'cas-1' });
    expect(await until(async () => ((await threadOf(me, cas.pubKey)).some((t) => t.text === 'eerste') ? true : null), { timeout: 20_000, step: 200 })).toBe(true);
    expect(await me.agent.setCircleMembersMayWrite(false)).toBe(false);
    await cas.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor(CIRCLE), threadId: me.pubKey, text: 'tweede', messageId: 'cas-2' });
    const where = await until(async () => {
      if ((await threadOf(me, cas.pubKey)).some((t) => t.text === 'tweede')) return 'thread';
      if ((await requestsOf(me)).some((q) => q.from === cas.pubKey)) return 'request';
      return null;
    }, { timeout: 20_000, step: 200 }).catch(() => null);
    expect(where, 'the second message is in neither the thread nor the requests').not.toBeNull();
  }, 60_000);
});
