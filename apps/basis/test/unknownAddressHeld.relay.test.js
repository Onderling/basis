/**
 * THE PERSON KEY SPEAKS ONLY FOR A REASON (the send gate, enforced). A send that is no circle's and no own device's
 * leaves on the person key only when an allowlist entry names it (an invite exchange, a granted view, a kept contact,
 * the person's address fallback). Anything else is HELD with the reason 'unknown-address': nothing on the wire, the
 * caller told why, and the send goes once this device learns who the address is (a contact lands, a roster read binds
 * it), within the hold's lifetime. Before this, such a send left on the person key and only the record said 'none'.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { deliveryAfterContactSend } from '../src/v2/contactTurnDelivery.js';
import { DELIVERY } from '../src/v2/deliveryState.js';
import { bootRealAgentNode, connectNodesOverRelay, until, teardown, addCardOf } from './support/pairRealAgents.js';

const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const boot = (label) => bootRealAgentNode(label, { itemsLane: true, contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend() } });

describe('a person-key send to an address this device knows nothing about is held, never sent', () => {
  let relay; let me; let bea;

  beforeAll(async () => {
    relay = await startJourneyRelay();
    [me, bea] = await Promise.all([boot('me'), boot('bea')]);
    await connectNodesOverRelay([me, bea], { relayUrl: relay.url });
  }, 120_000);
  afterAll(async () => { await teardown(me, bea); await relay?.close?.(); });

  it('held with its reason, and nothing reaches her', async () => {
    const r = await me.agent.sendPeerMessage(bea.pubKey, { type: 'p2p-chat', subtype: 'file-share', msgId: 'held-1', file: { id: 'f1', name: 'x.txt', dataB64: 'eA==' } });
    expect(r?.reason, JSON.stringify(r)).toBe('unknown-address');
    expect(r?.delivered).toBe(false);
    expect(r?.held, 'the caller is told it waits on this device, not that it failed for good').toBe(true);
  }, 30_000);

  it('a contact turn to her is held too, and she sees no request', async () => {
    const t = me.contactThreadChannel.sendTurn({ peerAddr: bea.pubKey, text: 'hoi Bea', messageId: 'me-held-1' });
    const sent = await t.sent.catch((e) => ({ error: String(e?.message ?? e) }));
    expect(JSON.stringify(sent)).toMatch(/unknown-address/);
    expect(deliveryAfterContactSend(sent).state, 'its bubble says it waits').toBe(DELIVERY.PENDING);
    await new Promise((res) => { setTimeout(res, 3000); });
    expect((await requestsOf(bea)).map((q) => q.from), 'a held turn reached her').not.toContain(me.pubKey);
  }, 30_000);

  it('once I keep her card, the held turn goes', async () => {
    await addCardOf(me, bea);
    expect(await until(async () => ((await requestsOf(bea)).some((q) => q.from === me.pubKey) ? true : null), { timeout: 20_000, step: 300 }),
      'the held turn never went after her card landed').toBe(true);
  }, 40_000);
});
