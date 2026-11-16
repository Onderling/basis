/**
 * "PEOPLE IN MY CIRCLES MAY WRITE TO ME" SWITCHED OFF AFTER A MEMBER ALREADY WROTE (found walking the phone,
 * 2026-11-14: the member's next message landed nowhere; Fable's ruling the same day):
 *   - NEVER ANSWERED: the person turned the switch off to stop exactly this, so the member's next message is a REQUEST,
 *     held without a card (the card rode only the first message), shown by their name in the circle. Accept needs no
 *     card: the held turns go onto the thread, the request goes, and Accept is the choice (Frits 2026-11-14): the member
 *     is a contact from then on, named as in the circle, and their next message lands in the thread. Their earlier turns
 *     stay in the thread.
 *   - ANSWERED: the person's answer made them a contact, and a contact is let on whatever the switch says.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown } from './support/pairRealAgents.js';
import { EventLog } from '../src/eventLog.js';
import { acceptMessageRequest } from '../src/v2/messageRequestAccept.js';

const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);
const has = (turns, text) => turns.some((t) => t.text === text);
const opts = () => ({ contactChannel: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) } });
const wait = (fn) => until(async () => ((await fn()) ? true : null), { timeout: 20_000, step: 200 }).catch(() => false);

describe('switched off after a member already wrote', () => {
  let relay; let me; let cas; let bo;
  const CIRCLE = 'straat';

  beforeAll(async () => {
    relay = await startJourneyRelay();
    me = await bootRealAgentNode('me', opts());
    cas = await bootRealAgentNode('cas', opts());
    bo = await bootRealAgentNode('bo', opts());
    await connectNodesOverRelay([me, cas, bo], { relayUrl: relay.url });
    await pairCircle(me, cas, { groupId: CIRCLE, name: 'Straat' });
    await pairCircle(me, bo, { groupId: 'hof', name: 'Hof' });
    await bindCircleAddresses([me, cas], CIRCLE);
    await bindCircleAddresses([me, bo], 'hof');
  }, 180_000);
  afterAll(async () => { await teardown(me, cas, bo); await relay?.close?.(); });

  it('never answered: the next message is a request without a card, named as in the circle; Accept puts it in the thread', async () => {
    await cas.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor(CIRCLE), threadId: me.pubKey, text: 'eerste', messageId: 'cas-1' });
    expect(await wait(async () => has(await threadOf(me, cas.pubKey), 'eerste'))).toBe(true);
    expect(await me.agent.setCircleMembersMayWrite(false)).toBe(false);
    await cas.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor(CIRCLE), threadId: me.pubKey, text: 'tweede', messageId: 'cas-2' });
    expect(await wait(async () => (await requestsOf(me)).some((q) => q.from === cas.pubKey)), 'the second message is not a request').toBe(true);
    const [q] = (await requestsOf(me)).filter((x) => x.from === cas.pubKey);
    expect(q.card).toBeNull();
    expect(q.member).toBe(true);
    expect(typeof q.name === 'string' && q.name.length > 0, `named as in the circle, got ${q.name}`).toBe(true);
    expect(q.turns.map((t) => t.text)).toEqual(['tweede']);
    expect(has(await threadOf(me, cas.pubKey), 'tweede')).toBe(false);
    expect(has(await threadOf(me, cas.pubKey), 'eerste'), 'the earlier turn stays').toBe(true);

    const r = await acceptMessageRequest({ callSkill: (a, o, x) => me.agent.callSkill(a, o, x), channel: me.contactThreadChannel, from: cas.pubKey });
    expect(r).toMatchObject({ accepted: true, turns: 1 });
    expect(has(await threadOf(me, cas.pubKey), 'tweede')).toBe(true);
    expect((await requestsOf(me)).some((x) => x.from === cas.pubKey)).toBe(false);

    // Accept IS the choice (Frits 2026-11-14): the member is a contact now, with no answer needed, so their next message
    // lands in the thread and never asks again
    const book = (await me.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? [];
    expect(book.some((c) => c.webid === cas.pubKey || c.pubKey === cas.pubKey), 'Accept made the book row').toBe(true);
    await cas.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor(CIRCLE), threadId: me.pubKey, text: 'derde', messageId: 'cas-3' });
    expect(await wait(async () => has(await threadOf(me, cas.pubKey), 'derde')), 'accepted, not answered: in the thread').toBe(true);
    expect((await requestsOf(me)).some((x) => x.from === cas.pubKey), 'no new request').toBe(false);
  }, 60_000);

  it('answered: the person\'s answer made them a contact, let on whatever the switch says', async () => {
    expect(await me.agent.setCircleMembersMayWrite(true)).toBe(true);
    await bo.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor('hof'), threadId: me.pubKey, text: 'hoi', messageId: 'bo-1' });
    expect(await wait(async () => has(await threadOf(me, bo.pubKey), 'hoi'))).toBe(true);
    await me.contactThreadChannel.sendTurn({ peerAddr: bo.agent.circleAddressFor('hof'), threadId: bo.pubKey, text: 'hoi terug', messageId: 'me-1' });
    expect(await wait(async () => has(await threadOf(bo, me.pubKey), 'hoi terug'))).toBe(true);
    expect(await me.agent.setCircleMembersMayWrite(false)).toBe(false);
    await bo.contactThreadChannel.sendTurn({ peerAddr: me.agent.circleAddressFor('hof'), threadId: me.pubKey, text: 'nog eens', messageId: 'bo-2' });
    expect(await wait(async () => has(await threadOf(me, bo.pubKey), 'nog eens')), 'an answered member lands in the thread').toBe(true);
    expect((await requestsOf(me)).some((q) => q.from === bo.pubKey)).toBe(false);
  }, 60_000);
});
