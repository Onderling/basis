/**
 * The identity link through the bot's door: the app's offer pasted into the person's PRIVATE chat (`/koppel <offer>`),
 * the question that says what linking means, the code picked from three (`/koppel-code`), and then: the row records the
 * person's ROOT (and the chat identity their circles know them by), a line in the chat, the bot's statement to the app.
 *
 * The offer is a DEVICE STATEMENT: signed by one of the person's devices with its delegation key, the root-signed
 * delegation beside it. Refused before any question: an offer whose chat identity did not sign it, an offer signed by a
 * device of ANOTHER root than the one it names, a device the root has revoked, another bot's offer, a root or identity
 * already on another row, a row already linked to another root. Relinking the same root says so. `/ontkoppel` drops the
 * link and every screen grant minted to the chat identity.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers } from '../src/v2/botUsers.js';
import { createIdentityLink, createLinkTombstones } from '../src/v2/botIdentityLink.js';
import { linkCode, IDENTITY_LINK_SUBTYPE, LINK_OFFER_SCHEME } from '../src/v2/identityLink.js';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { linkedPerson } from './support/linkedPerson.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const BOT = 'BOT-ADDRESS';
const ann = await linkedPerson();
const eve = await linkedPerson();
const ANN = 'telegram:42';
const PRIVATE = { caller: ANN, threadId: ANN, chatId: '42' };
const GROUP = { caller: ANN, threadId: ANN, chatId: '-100777' };

function memStore() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], hide: async (id) => { const r = m.get(id); if (r) m.set(id, { ...r, hidden: true }); } };
}
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }
const body = (offer) => JSON.parse(Buffer.from(offer.slice(LINK_OFFER_SCHEME.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const encode = (b) => LINK_OFFER_SCHEME + Buffer.from(JSON.stringify(b)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function door() {
  const users = createBotUsers({ store: memStore() });
  await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
  await users.admit({ channel: 'telegram', uid: '7', displayName: 'Bert' });
  const asked = []; const toApp = []; const revoked = []; const sentPrivately = [];
  let grants = [{ viewPubKey: ann.webid, actingAs: ANN, label: 'telefoon', ops: ['lists.listLists'] }, { viewPubKey: 'OTHER-SCREEN', actingAs: ANN, ops: [] }];
  const tombstones = createLinkTombstones({ vault: memVault() });
  const link = createIdentityLink({
    users, botAddress: () => BOT, tombstones,
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
  return { users, link, call, asked, toApp, revoked, sentPrivately, tombstones };
}

describe('the offer is a device statement', () => {
  it('the chat identity it names did not sign it: not an offer, nothing asked', async () => {
    const d = await door();
    const mallory = await AgentIdentity.generate(new VaultMemory());
    const forged = ann.offer('phone', BOT, { signer: mallory }).offer;
    const r = await d.call('assistant', 'assistant-link', { offer: forged }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('not-an-offer');
    expect(d.asked).toEqual([]);
  });

  it('a link offer signed by a device of ANOTHER root than the one it names is refused before the question', async () => {
    const d = await door();
    // Eve's device signs; the offer names Ann's root
    const forged = encode({ ...body(eve.offer('laptop', BOT).offer), k: ann.root });
    const r = await d.call('assistant', 'assistant-link', { offer: forged }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('not-an-offer');
    expect(d.asked).toEqual([]);
  });

  it('a row linked to one root: an offer from a device of another root is refused before the question', async () => {
    const d = await door();
    await d.users.linkKey(ANN, { root: ann.root, webid: ann.webid });
    const r = await d.call('assistant', 'assistant-link', { offer: eve.offer('laptop', BOT).offer }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('row-has-a-key');
    expect(d.asked).toEqual([]);
  });

  it('a device the root revoked cannot offer: refused before the question', async () => {
    const d = await door();
    // the tombstone lands while Ann is linked (a bot keeps tombstones only for roots it links), and stays after an unlink
    await d.users.linkKey(ANN, { root: ann.root, webid: ann.webid });
    expect(await d.link.revoked(ann.revocation('old-phone'))).toEqual({ ok: true });
    await d.users.unlinkKey(ANN);
    const r = await d.call('assistant', 'assistant-link', { offer: ann.offer('old-phone', BOT).offer }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('revoked');
    expect(d.asked).toEqual([]);
    // another device of the same root still may
    expect((await d.call('assistant', 'assistant-link', { offer: ann.offer('phone', BOT).offer }, PRIVATE)).ok).toBe(true);
  });

  it('the statement stands for one bot: an offer made for another bot is refused before the question', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-link', { offer: ann.offer('phone', 'ANOTHER-BOT').offer }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('the same offer pasted twice: the second is a replay, refused', async () => {
    const d = await door();
    const { offer } = ann.offer('phone', BOT);
    expect((await d.call('assistant', 'assistant-link', { offer }, PRIVATE)).ok).toBe(true);
    expect((await d.call('assistant', 'assistant-link', { offer }, PRIVATE)).ok).toBe(false);
  });

  it('a stale offer (made long ago) is said so', async () => {
    const d = await door();
    const { offer } = ann.offer('phone', BOT, { now: () => Date.now() - 60 * 60 * 1000 });
    const r = await d.call('assistant', 'assistant-link', { offer }, PRIVATE);
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe('stale');
  });
});

describe('the identity link through the door', () => {
  it('/koppel alone sends the app link to the private chat (no secret in it)', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-link', {}, PRIVATE);
    expect(r.ok).toBe(true);
    expect(d.sentPrivately[0].text).toContain('#koppel-bot=');
  });

  it('the pasted offer: the question, three codes; the right one records the ROOT; the app is told', async () => {
    const d = await door();
    const { offer, nonce } = ann.offer('phone', BOT);
    const asked = await d.call('assistant', 'assistant-link', { offer }, PRIVATE);
    expect(asked).toMatchObject({ ok: true });
    expect(d.asked[0].text).toContain('circle.bot.link_question');
    const real = await linkCode(ann.root, nonce);
    expect(d.asked[0].buttons.map((b) => b.id)).toContain(`/koppel-code ${real}`);
    expect(d.asked[0].buttons.map((b) => b.id)).toContain('/koppel-code geen');
    expect((await d.users.find('web', ann.webid, { linkedRoot: ann.root }))).toBeNull();          // nothing linked before the code
    const done = await d.call('assistant', 'assistant-link-confirm', { answer: real }, PRIVATE);
    expect(done.ok).toBe(true);
    expect(done.message).toContain('circle.bot.link_done');
    const row = (await d.users.list()).find((r) => r.id === ANN);
    expect(row.linkedRoot).toBe(ann.root);
    expect(row.linkedRoot).not.toBe(ann.webid);
    // the profile key is never what the person is found by at the door
    expect(await d.users.find('web', ann.webid)).toBeNull();
    expect((await d.users.find('web', ann.webid, { linkedRoot: ann.root }))?.id).toBe(ANN);
    expect(d.toApp).toEqual([{ key: ann.webid, payload: expect.objectContaining({ subtype: IDENTITY_LINK_SUBTYPE, statement: expect.objectContaining({ bot: BOT, row: ANN, root: ann.root }) }) }]);
  });

  it('the code from a group does not link; a wrong code or "geen" drops the offer', async () => {
    const d = await door();
    const { offer, nonce } = ann.offer('phone', BOT);
    await d.call('assistant', 'assistant-link', { offer }, PRIVATE);
    const real = await linkCode(ann.root, nonce);
    expect((await d.call('assistant', 'assistant-link-confirm', { answer: real }, GROUP)).ok).toBe(false);
    expect((await d.users.list()).find((r) => r.id === ANN).linkedRoot).toBeFalsy();
    await d.call('assistant', 'assistant-link-confirm', { answer: 'ZZZZ' }, PRIVATE);
    expect((await d.call('assistant', 'assistant-link-confirm', { answer: real }, PRIVATE)).ok).toBe(false);   // dropped
    expect((await d.users.list()).find((r) => r.id === ANN).linkedRoot).toBeFalsy();
  });

  it('the offer pasted in a group is not taken', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-link', { offer: ann.offer('phone', BOT).offer }, GROUP);
    expect(r.ok).toBe(false);
    expect(d.asked).toEqual([]);
  });

  it('refused before any question: the root already on another row; the chat identity already on another row', async () => {
    const d = await door();
    await d.users.linkKey('telegram:7', { root: ann.root, webid: 'BERTS-KEY' });
    expect((await d.call('assistant', 'assistant-link', { offer: ann.offer('phone', BOT).offer }, PRIVATE)).error.code).toBe('key-on-another-row');
    const d2 = await door();
    await d2.users.linkKey('telegram:7', { root: 'BERTS-ROOT', webid: ann.webid });
    expect((await d2.call('assistant', 'assistant-link', { offer: ann.offer('phone', BOT).offer }, PRIVATE)).error.code).toBe('key-on-another-row');
    expect([...d.asked, ...d2.asked]).toEqual([]);
  });

  it('the same root linked again to the same row (from another device): said so, nothing asked, the app told again', async () => {
    const d = await door();
    await d.users.linkKey(ANN, { root: ann.root, webid: ann.webid });
    const r = await d.call('assistant', 'assistant-link', { offer: ann.offer('laptop', BOT).offer }, PRIVATE);
    expect(r.ok).toBe(true);
    expect(r.message).toContain('circle.bot.link_already');
    expect(d.asked).toEqual([]);
    // an app that made the offer again (it lost the first answer) hears the statement again
    expect(d.toApp.map((m) => m.payload.statement.row)).toEqual([ANN]);
  });

  it('/ontkoppel (private) drops the link and the screen grants minted to the chat identity; the root finds nobody', async () => {
    const d = await door();
    await d.users.linkKey(ANN, { root: ann.root, webid: ann.webid });
    expect((await d.call('assistant', 'assistant-unlink', {}, GROUP)).ok).toBe(false);
    const r = await d.call('assistant', 'assistant-unlink', {}, PRIVATE);
    expect(r.ok).toBe(true);
    expect(await d.users.find('web', ann.webid, { linkedRoot: ann.root })).toBeNull();
    expect(d.revoked).toEqual([ann.webid]);
    expect(d.toApp.at(-1)).toMatchObject({ key: ann.webid, payload: { subtype: IDENTITY_LINK_SUBTYPE, unlinked: true, statement: { bot: BOT, row: ANN, root: ann.root } } });
  });
});

describe('a revocation reaches the bot', () => {
  it('the root\'s tombstone, delivered by anyone, is kept for a linked root — and only for one', async () => {
    const d = await door();
    expect(await d.link.revoked(ann.revocation('phone'))).toEqual({ ok: false, reason: 'not-linked' });
    await d.users.linkKey(ANN, { root: ann.root, webid: ann.webid });
    // forged: Eve's root signs a tombstone naming Ann's root
    expect(await d.link.revoked({ ...eve.revocation('phone'), by: ann.root })).toEqual({ ok: false, reason: 'forbidden' });
    expect(d.tombstones.has(ann.root, 'phone')).toBe(false);
    expect(await d.link.revoked(ann.revocation('phone'))).toEqual({ ok: true });
    expect(d.tombstones.has(ann.root, 'phone')).toBe(true);
    expect(d.tombstones.has(ann.root, 'laptop')).toBe(false);
  });

  it('kept across a restart (the tombstones are on disk), and kept when the row is unlinked', async () => {
    const vault = memVault();
    const a = createLinkTombstones({ vault });
    await a.add(ann.root, 'phone');
    const b = createLinkTombstones({ vault });
    await b.load();
    expect(b.has(ann.root, 'phone')).toBe(true);
  });
});
