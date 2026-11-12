/**
 * SHARING MY CONTACT LINK IS CHOOSING TO BE REACHABLE BY WHOEVER OPENS IT FIRST (L806, Frits 2026-11-12).
 *
 * Measured before: after message requests, the person who opened a shared link and wrote first was held as a request,
 * though the person had handed them the link (eight browser walks went red on it). Two real agents with the contact
 * channel composed as the shells compose it: Anna shares her link; Bob opens it, adds her and writes. His turn carries
 * the link's one-time token inside the seal; Anna's door lets him on as it lets on a circle member (a thread, no book row
 * until she answers). Carol opens the SAME link after him: it is used, so she is a request.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown } from './support/pairRealAgents.js';
import { loadShareMyContact, contactCardFromLink } from '../src/v2/contactCardLink.js';

const requestsOf = async (node) => (await node.agent.callSkill('pinboard', 'listMessageRequests', {}))?.requests ?? [];
const contactsOf = async (node) => (await node.agent.callSkill('pinboard', 'listContacts', {}))?.contacts ?? [];
const linksOf = async (node) => (await node.agent.callSkill('pinboard', 'listSharedCards', {}))?.links ?? [];
const threadOf = async (node, contactId) => ((await node.contactThreadChannel.rehydrate?.(contactId)) ?? []);
const APP = 'https://onderling.example/basis/';

describe('a shared link lets its first opener write; anyone after is a request', () => {
  let anna; let bob; let carol;
  let link;
  beforeAll(async () => {
    anna = await bootRealAgentNode('anna', { contactChannel: true });
    bob = await bootRealAgentNode('bob', { contactChannel: true });
    carol = await bootRealAgentNode('carol', { contactChannel: true });
    await connectNodesOverBus([anna, bob, carol]);
    const shown = await loadShareMyContact({ callSkill: (a, o, x) => anna.agent.callSkill(a, o, x), appUrl: APP });
    expect(shown.token, 'the panel minted no token').toBeTruthy();
    link = shown.link;
  }, 90_000);
  afterAll(async () => { await teardown(anna, bob, carol); });

  const openAndAdd = async (node) => {
    const opened = contactCardFromLink(link);
    expect(opened).toMatchObject({ ok: true });
    expect(opened.token).toBeTruthy();
    const r = await node.agent.callSkill('pinboard', 'addContactFromQr', { payload: opened.payload, linkToken: opened.token });
    expect(r?.error ?? null).toBe(null);
  };

  it('Bob opens the link and writes: his turn is on Anna\'s thread, not a request, and he is not in her book', async () => {
    await openAndAdd(bob);
    await bob.contactThreadChannel.sendTurn({ peerAddr: anna.pubKey, text: 'hoi Anna, via je link', messageId: 'bob-1' });
    const landed = await until(async () => ((await threadOf(anna, bob.pubKey)).some((t) => t.text === 'hoi Anna, via je link') ? true : null), { timeout: 15_000, step: 100 });
    expect(landed, `not on the thread; requests ${JSON.stringify((await requestsOf(anna)).map((q) => q.from))}`).toBe(true);
    expect((await requestsOf(anna)).map((q) => q.from)).not.toContain(bob.pubKey);
    await new Promise((r) => { setTimeout(r, 1000); });
    expect((await contactsOf(anna)).map((c) => c.webid), 'a link opener became a contact before Anna answered').not.toContain(bob.pubKey);
    const [l] = await linksOf(anna);
    expect(l).toMatchObject({ state: 'used', usedBy: bob.pubKey });
    // the token left with the first turn: Bob's row no longer holds it
    const row = (await contactsOf(bob)).find((c) => c.webid === anna.pubKey);
    expect(row?.linkToken ?? null).toBe(null);
  }, 40_000);

  it('Bob writes again (no token now): the turn is on the thread too', async () => {
    await bob.contactThreadChannel.sendTurn({ peerAddr: anna.pubKey, text: 'ben je daar?', messageId: 'bob-2' });
    expect(await until(async () => ((await threadOf(anna, bob.pubKey)).some((t) => t.text === 'ben je daar?') ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    expect((await requestsOf(anna)).map((q) => q.from)).not.toContain(bob.pubKey);
  }, 40_000);

  it('Carol opens the same link after him: it is used, so she is a request', async () => {
    await openAndAdd(carol);
    await carol.contactThreadChannel.sendTurn({ peerAddr: anna.pubKey, text: 'hallo', messageId: 'carol-1' });
    expect(await until(async () => ((await requestsOf(anna)).some((q) => q.from === carol.pubKey) ? true : null), { timeout: 15_000, step: 100 })).toBe(true);
    expect((await threadOf(anna, carol.pubKey)).map((t) => t.text)).toEqual([]);
  }, 40_000);
});
