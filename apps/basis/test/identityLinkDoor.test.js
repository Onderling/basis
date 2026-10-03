/**
 * The identity link through the bot's door (Fable's conditions, identity-link brief): the app's offer pasted into the
 * person's PRIVATE chat (`/koppel <offer>`), the question that says what linking means, the code picked from three
 * (`/koppel-code`), and then: the row gains the key, a line in the chat, the bot's statement to the app's key.
 * Refused before any question: another bot's offer, a key on another row; relinking says so; `/ontkoppel` drops the
 * key and every screen grant minted to it.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers } from '../src/v2/botUsers.js';
import { createIdentityLink } from '../src/v2/botIdentityLink.js';
import { encodeLinkOffer, linkCode, linkOfferMessage, IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';
import { AgentIdentity, b64encode } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const BOT = 'BOT-ADDRESS';
// Ann's person key: a real identity, so her app can sign its offer
const ANN_ID = await AgentIdentity.generate(new VaultMemory());
const KEY = ANN_ID.pubKey;
const signAs = (id) => (message) => b64encode(id.sign(message));
const ANN = 'telegram:42';
const PRIVATE = { caller: ANN, threadId: ANN, chatId: '42' };
const GROUP = { caller: ANN, threadId: ANN, chatId: '-100777' };

function memStore() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], hide: async (id) => { const r = m.get(id); if (r) m.set(id, { ...r, hidden: true }); } };
}

async function door() {
  const users = createBotUsers({ store: memStore() });
  await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
  await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bert' });
  const asked = []; const toApp = []; const revoked = []; const sentPrivately = [];
  let grants = [{ viewPubKey: KEY, actingAs: ANN, label: 'telefoon', ops: ['lists.listLists'] }, { viewPubKey: 'OTHER-SCREEN', actingAs: ANN, ops: [] }];
  const link = createIdentityLink({
    users, botAddress: () => BOT,
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    sendPrivately: async (person, text) => { sentPrivately.push({ person, text }); return { ok: true }; },
    tellApp: async (key, payload) => { toApp.push({ key, payload }); },
    listGrants: async () => grants,
    revokeView: async (viewPubKey) => { revoked.push(viewPubKey); grants = grants.filter((g) => g.viewPubKey !== viewPubKey); return true; },
    where: () => ({ appUrl: 'https://basis.example/app', botAddress: BOT, relayUrl: 'wss://r', botName: '@bot' }),
  });
  const call = withAssistantOps({
    callSkill: async () => ({ params: [] }), t, refusal: async () => null, threads: { langOf: () => null },
    admin: { users: async () => users.list(), identityLink: link },
  });
  const offer = (o = {}) => encodeLinkOffer({ personKey: KEY, botAddress: BOT, sign: signAs(ANN_ID), ...o });
  return { users, link, call, asked, toApp, revoked, sentPrivately, offer };
}

describe('the offer is signed by the key it names', () => {
  it('another person\'s key, unsigned: not an offer, nothing asked', async () => {
    const d = await door();
    const unsigned = encodeLinkOffer({ personKey: KEY, botAddress: BOT, sign: () => '' }).offer;
    const r = await d.call('assistant', 'assistant-link', { offer: unsigned }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('not-an-offer');
    expect(d.asked).toEqual([]);
  });

  it('signed with a different key than the one it names: not an offer, nothing asked', async () => {
    const d = await door();
    const mallory = await AgentIdentity.generate(new VaultMemory());
    const forged = encodeLinkOffer({ personKey: KEY, botAddress: BOT, sign: signAs(mallory) }).offer;
    const r = await d.call('assistant', 'assistant-link', { offer: forged }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('not-an-offer');
    expect(d.asked).toEqual([]);
  });

  it('the signature covers the bot and the nonce too: a signed offer altered after signing is not an offer', async () => {
    const d = await door();
    const { offer } = encodeLinkOffer({ personKey: KEY, botAddress: 'ANOTHER-BOT', sign: signAs(ANN_ID) });
    // rewrite the bot inside the signed offer to this bot
    const body = JSON.parse(Buffer.from(offer.slice('onderling-koppel:'.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    const altered = 'onderling-koppel:' + Buffer.from(JSON.stringify({ ...body, b: BOT })).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect((await d.call('assistant', 'assistant-link', { offer: altered }, PRIVATE)).error.code).toBe('not-an-offer');
    expect(linkOfferMessage({ k: KEY, b: BOT, n: 'x' })).toContain(BOT);
  });

  it('the real one: the question as before', async () => {
    const d = await door();
    expect((await d.call('assistant', 'assistant-link', { offer: d.offer().offer }, PRIVATE)).ok).toBe(true);
    expect(d.asked).toHaveLength(1);
  });
});

describe('the identity link through the door', () => {
  it('/koppel alone sends the app link to the private chat (no secret in it)', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-link', {}, PRIVATE);
    expect(r.ok).toBe(true);
    expect(d.sentPrivately[0].text).toContain('#koppel-bot=');
  });

  it('the pasted offer: the question says what linking means, three codes; the right one links; the app is told', async () => {
    const d = await door();
    const { offer, nonce } = d.offer();
    const asked = await d.call('assistant', 'assistant-link', { offer }, PRIVATE);
    expect(asked).toMatchObject({ ok: true });
    expect(d.asked[0].text).toContain('circle.bot.link_question');
    const real = await linkCode(KEY, nonce);
    expect(d.asked[0].buttons.map((b) => b.id)).toContain(`/koppel-code ${real}`);
    expect(d.asked[0].buttons.map((b) => b.id)).toContain('/koppel-code geen');
    expect((await d.users.find('web', KEY))).toBeNull();          // nothing linked before the code
    const done = await d.call('assistant', 'assistant-link-confirm', { answer: real }, PRIVATE);
    expect(done.ok).toBe(true);
    expect(done.message).toContain('circle.bot.link_done');
    expect((await d.users.find('web', KEY))?.id).toBe(ANN);
    expect(d.toApp).toEqual([{ key: KEY, payload: expect.objectContaining({ subtype: IDENTITY_LINK_SUBTYPE, statement: expect.objectContaining({ bot: BOT, row: ANN, key: KEY }) }) }]);
  });

  it('the code from a group does not link; a wrong code or "geen" drops the offer', async () => {
    const d = await door();
    const { offer, nonce } = d.offer();
    await d.call('assistant', 'assistant-link', { offer }, PRIVATE);
    const real = await linkCode(KEY, nonce);
    expect((await d.call('assistant', 'assistant-link-confirm', { answer: real }, GROUP)).ok).toBe(false);
    expect(await d.users.find('web', KEY)).toBeNull();
    await d.call('assistant', 'assistant-link-confirm', { answer: 'ZZZZ' }, PRIVATE);
    expect((await d.call('assistant', 'assistant-link-confirm', { answer: real }, PRIVATE)).ok).toBe(false);   // dropped
    expect(await d.users.find('web', KEY)).toBeNull();
  });

  it('the offer pasted in a group is not taken', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-link', { offer: d.offer().offer }, GROUP);
    expect(r.ok).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('refused before any question: another bot\'s offer; a key already on another row', async () => {
    const d = await door();
    expect((await d.call('assistant', 'assistant-link', { offer: encodeLinkOffer({ personKey: KEY, botAddress: 'ANOTHER-BOT', sign: signAs(ANN_ID) }).offer }, PRIVATE)).ok).toBe(false);
    await d.users.linkKey('telegram:7', KEY);
    expect((await d.call('assistant', 'assistant-link', { offer: d.offer().offer }, PRIVATE)).ok).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('the same key linked again to the same row: said so, nothing asked', async () => {
    const d = await door();
    await d.users.linkKey(ANN, KEY);
    const r = await d.call('assistant', 'assistant-link', { offer: d.offer().offer }, PRIVATE);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('circle.bot.link_already');
    expect(d.asked).toEqual([]);
  });

  it('/ontkoppel (private) drops the key and the screen grants minted to it; the key is a stranger again', async () => {
    const d = await door();
    await d.users.linkKey(ANN, KEY);
    expect((await d.call('assistant', 'assistant-unlink', {}, GROUP)).ok).toBe(false);
    const r = await d.call('assistant', 'assistant-unlink', {}, PRIVATE);
    expect(r.ok).toBe(true);
    expect(await d.users.find('web', KEY)).toBeNull();
    expect(d.revoked).toEqual([KEY]);
  });
});
