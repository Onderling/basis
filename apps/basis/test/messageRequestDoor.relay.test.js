/**
 * A FIRST MESSAGE FROM SOMEONE THE PERSON DID NOT CHOOSE IS A REQUEST (Frits 2026-11-12).
 *
 * Measured before this door: a stranger's first contact turn wrote a full contact row on the receiver (the card riding
 * the message went into the book) and the pair roster made a pair circle, before anything was decided. Two real agents
 * with the contact channel composed as the shells compose it: Anna writes to Bob, who never chose her. Bob's device holds
 * her turn as a request, and keeps NO book row, NO pair circle, NO thread turn. Someone Bob did choose (her card in his
 * book) lands in the thread as before.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown } from './support/pairRealAgents.js';
import { isPairCircleId } from '../src/v2/pairCircleId.js';
import { acceptMessageRequest } from '../src/v2/messageRequestAccept.js';

const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const contactsOf = async (node) => (await node.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? [];
const pairCirclesOf = async (node) => ((await node.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? [])
  .map((c) => (typeof c === 'string' ? c : (c?.groupId ?? c?.id))).filter((id) => isPairCircleId(id));
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);

describe('a stranger\'s first message is a request, not a contact', () => {
  let anna; let bob; let carol; let dave;
  beforeAll(async () => {
    anna = await bootRealAgentNode('anna', { contactChannel: true });
    bob = await bootRealAgentNode('bob', { contactChannel: true });
    carol = await bootRealAgentNode('carol', { contactChannel: true });
    dave = await bootRealAgentNode('dave', { contactChannel: true });
    await connectNodesOverBus([anna, bob, carol, dave]);
  }, 90_000);
  afterAll(async () => { await teardown(anna, bob, carol, dave); });

  it('Anna writes first: Bob holds a request, and keeps no contact row, no pair circle, no thread turn', async () => {
    await anna.contactThreadChannel.sendTurn({ peerAddr: bob.pubKey, text: 'hoi Bob', messageId: 'anna-1' });
    const held = await until(async () => ((await requestsOf(bob)).some((q) => q.turns.some((t) => t.messageId === 'anna-1')) ? true : null), { timeout: 15_000, step: 100 });
    expect(held, `no request on Bob's device; contacts ${JSON.stringify((await contactsOf(bob)).map((c) => c.webid))}`).toBe(true);
    const [q] = await requestsOf(bob);
    expect(q.from).toBe(anna.pubKey);
    expect(q.turns.map((t) => t.text)).toEqual(['hoi Bob']);
    // give any late writer (the card's add, the pair roster) time to do the wrong thing
    await new Promise((r) => { setTimeout(r, 1500); });
    expect((await contactsOf(bob)).map((c) => c.webid), 'a stranger became a contact').not.toContain(anna.pubKey);
    expect(await pairCirclesOf(bob), 'a stranger got a pair circle').toEqual([]);
    expect((await threadOf(bob, anna.pubKey)).map((t) => t.text), 'a stranger\'s turn is on the thread').toEqual([]);
  }, 40_000);

  it('Anna writes again: the turn lands on the same request', async () => {
    await anna.contactThreadChannel.sendTurn({ peerAddr: bob.pubKey, text: 'ben je daar?', messageId: 'anna-2' });
    expect(await until(async () => ((await requestsOf(bob))[0]?.turns.length === 2 ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    expect((await contactsOf(bob)).map((c) => c.webid)).not.toContain(anna.pubKey);
  }, 40_000);

  it('Bob accepts: Anna is a contact, her two held turns are on the thread in order, the request is gone', async () => {
    const r = await acceptMessageRequest({ callSkill: (a, o, x) => bob.agent.callSkill(a, o, x), channel: bob.contactThreadChannel, from: anna.pubKey });
    expect(r).toMatchObject({ accepted: true, turns: 2 });
    expect((await contactsOf(bob)).map((c) => c.webid)).toContain(anna.pubKey);
    expect((await threadOf(bob, anna.pubKey)).map((t) => t.text)).toEqual(['hoi Bob', 'ben je daar?']);
    expect(await requestsOf(bob)).toEqual([]);
    // from now on her turns land in the thread
    await anna.contactThreadChannel.sendTurn({ peerAddr: bob.pubKey, text: 'fijn', messageId: 'anna-3' });
    expect(await until(async () => ((await threadOf(bob, anna.pubKey)).some((t) => t.text === 'fijn') ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    expect(await requestsOf(bob)).toEqual([]);
  }, 40_000);

  it('Carol, whom Bob chose (her card in his book), lands in the thread as before', async () => {
    const card = (await carol.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    expect((await bob.agent.callSkill('pinboard', 'addContactFromQr', { payload: card }))?.error ?? null).toBe(null);
    await carol.contactThreadChannel.sendTurn({ peerAddr: bob.pubKey, text: 'hallo', messageId: 'carol-1' });
    expect(await until(async () => ((await threadOf(bob, carol.pubKey)).some((t) => t.text === 'hallo') ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    expect((await requestsOf(bob)).map((q) => q.from)).not.toContain(carol.pubKey);
  }, 40_000);

  it('Bob writes to Dave first: Dave\'s answer lands in Bob\'s thread, never as a request on his side', async () => {
    await bob.contactThreadChannel.sendTurn({ peerAddr: dave.pubKey, text: 'dag Dave', messageId: 'bob-1' });
    // on Dave's side Bob is a stranger: his turn is a request there
    expect(await until(async () => ((await requestsOf(dave)).some((q) => q.from === bob.pubKey) ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    await dave.contactThreadChannel.sendTurn({ peerAddr: bob.pubKey, text: 'dag Bob', messageId: 'dave-1' });
    expect(await until(async () => ((await threadOf(bob, dave.pubKey)).some((t) => t.text === 'dag Bob') ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    expect((await requestsOf(bob)).map((q) => q.from)).not.toContain(dave.pubKey);
  }, 40_000);
});
