/**
 * EACH PERSONA DECIDES FOR ITSELF WHO MAY WRITE TO IT FIRST (Frits 2026-11-12: "for each message it is totally clear
 * what persona it is written for"). The address a message arrives on names the persona (the secure agent picks the
 * identity that answers there); the door reads THAT persona's policy and files a held request under THAT persona.
 *
 * The phone has its general persona (policy request) and a second persona, "Onderling" (policy open: the feedback
 * persona). A stranger writes to each: the one to Onderling lands in the thread; the one to the general persona is a
 * request, filed under the general persona, never under Onderling.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';

const requestsOf = async (node, persona = null) => (await node.agent.callSkill('pinboard', 'listMessageRequests', persona ? { persona } : {}))?.requests ?? [];
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);

describe('each persona decides who may write to it first', () => {
  let relay; let phone; let stranger; let other; let O; let onderlingId;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    phone = await bootRealAgentNode('phone', { contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
    stranger = await bootRealAgentNode('tester', { contactChannel: true });
    other = await bootRealAgentNode('other', { contactChannel: true });
    await connectNodesOverRelay([phone, stranger, other], { relayUrl: relay.url });
    onderlingId = (await phone.agent.callSkill('agents', 'createProfile', { name: 'Onderling' })).id;
    O = phone.agent.persona(onderlingId);
    await phone.agent.sa.relays.add(relay.url, { identity: O.chatId, awaitReady: true });
    expect(await phone.agent.setFirstMessages('open', { persona: onderlingId })).toBe('open');
  }, 120_000);
  afterAll(async () => { await teardown(phone, stranger, other); await relay?.close?.(); });

  it('the general persona stays request; Onderling is open', async () => {
    expect(await phone.agent.messageRequests.policy(phone.pubKey)).toBe('request');
    expect(await phone.agent.messageRequests.policy(O.chatId.pubKey)).toBe('open');
  });

  it('a stranger writing to Onderling lands in the thread, no request anywhere', async () => {
    await stranger.contactThreadChannel.sendTurn({ peerAddr: O.chatId.pubKey, text: 'feedback: de knop doet niets', messageId: 'fb-1' });
    expect(await until(async () => ((await threadOf(phone, stranger.pubKey)).some((t) => t.text === 'feedback: de knop doet niets') ? true : null), { timeout: 20_000, step: 200 })).toBe(true);
    expect(await requestsOf(phone)).toEqual([]);
    expect(await requestsOf(phone, onderlingId)).toEqual([]);
  }, 40_000);

  it('a stranger writing to the general persona is a request, filed under the general persona', async () => {
    await other.contactThreadChannel.sendTurn({ peerAddr: phone.pubKey, text: 'hoi', messageId: 'o-1' });
    expect(await until(async () => ((await requestsOf(phone)).some((q) => q.from === other.pubKey) ? true : null), { timeout: 20_000, step: 200 })).toBe(true);
    expect((await requestsOf(phone, onderlingId)).map((q) => q.from)).not.toContain(other.pubKey);
    expect((await threadOf(phone, other.pubKey)).map((t) => t.text)).toEqual([]);
  }, 40_000);
});
