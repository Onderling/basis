/**
 * The household in your own app (B3, Fable's shape): behind the admin's setting `assistant.householdInApp` (off by
 * default), a person who has just linked their Basis identity (`/koppel`) is asked, privately, whether they want the
 * household in their own app too. On yes: an invite bound to THEIR chat key (the key `/koppel` linked), single use,
 * 24 hours, sent only to their private chat. From a group, from a screen, before linking, or with the setting off:
 * no invite.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers, linkedKeyOf } from '../src/v2/botUsers.js';
import { createIdentityLink } from '../src/v2/botIdentityLink.js';
import { encodeLinkOffer, linkCode } from '../src/v2/identityLink.js';
import { AgentIdentity, b64encode } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { EventLog } from '../src/eventLog.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const BOT = 'BOT-ADDRESS';
const ANN_ID = await AgentIdentity.generate(new VaultMemory());
const KEY = ANN_ID.pubKey;
const ANN = 'telegram:42';
const ADMIN = 'telegram:9';
const PRIVATE = { caller: ANN, threadId: ANN, chatId: '42' };
const GROUP = { caller: ANN, threadId: ANN, chatId: '-100777' };

function memStore() {
  const m = new Map();
  return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()], hide: async (id) => { const r = m.get(id); if (r) m.set(id, { ...r, hidden: true }); } };
}

async function door({ setting = null } = {}) {
  const users = createBotUsers({ store: memStore() });
  await users.admit({ channel: 'telegram', uid: '9', displayName: 'Anne', role: 'admin' });
  await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });
  const asked = [];
  const link = createIdentityLink({
    users, botAddress: () => BOT,
    ask: async (person, q) => { asked.push({ person, ...q }); return { ok: true }; },
    sendPrivately: async () => ({ ok: true }), tellApp: async () => {}, listGrants: async () => [], revokeView: async () => true,
    where: () => ({ appUrl: 'https://basis.example/app', botAddress: BOT, relayUrl: 'wss://r', botName: '@bot' }),
  });
  const params = new Map(setting ? [['assistant.householdInApp', setting]] : []);
  const invited = []; const evicted = [];
  const call = withAssistantOps({
    callSkill: async (app, op, args) => {
      if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...params].map(([key, value]) => ({ key, value })) };
      if (app === 'params' && op === 'set-param') { params.set(args.key, args.value); return { ok: true }; }
      return { ok: true };
    },
    t, refusal: async () => null, threads: createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() }),
    admin: {
      users: async () => users.list(), identityLink: link,
      householdInApp: { inviteFor: async (key) => { invited.push(key); return { ok: true, uri: `onderling-invite://for-${key.slice(0, 6)}`, expiresAt: Date.now() + 86_400_000 }; }, evict: async (key) => { evicted.push(key); return { removed: 1 }; } },
      revoke: async (who) => (await users.list()).find((u) => u.displayName === who) ?? null,
    },
  });
  const linkAnn = async () => {
    const { offer, nonce } = encodeLinkOffer({ personKey: KEY, botAddress: BOT, sign: (m) => b64encode(ANN_ID.sign(m)) });
    await call('assistant', 'assistant-link', { offer }, PRIVATE);
    return call('assistant', 'assistant-link-confirm', { answer: await linkCode(KEY, nonce) }, PRIVATE);
  };
  return { call, linkAnn, invited, evicted, params, users };
}

describe('the setting', () => {
  it('is the household\'s, off by default; the admin turns it on', async () => {
    const d = await door();
    const r = await d.call('assistant', 'assistant-settings', { change: 'app on' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(d.params.get('assistant.householdInApp')).toBe('on');
    expect((await d.call('assistant', 'assistant-settings', { change: 'app maybe' }, { caller: ADMIN, threadId: ADMIN })).ok).toBe(false);
  });
});

describe('the question after /koppel', () => {
  it('setting off: linked, and nothing asked', async () => {
    const d = await door();
    const done = await d.linkAnn();
    expect(done.ok).toBe(true);
    expect(done.message).not.toContain('circle.bot.inapp_question');
  });
  it('setting on: linked, then the question with yes and no', async () => {
    const d = await door({ setting: 'on' });
    const done = await d.linkAnn();
    expect(done.message).toContain('circle.bot.link_done');
    expect(done.message).toContain('circle.bot.inapp_question');
    // the way out is said with the way in (Fable)
    const nl = (await import('../src/locales/circle.nl.json', { with: { type: 'json' } })).default;
    expect(nl.bot.inapp_question).toMatch(/Je kunt er later via je app weer uit\.$/);
    expect((done.quickReplies ?? []).map((b) => b.slash)).toEqual(expect.arrayContaining(['/in-app ja', '/in-app nee']));
  });
  it('yes, privately: an invite bound to the linked key; no: nothing', async () => {
    const d = await door({ setting: 'on' });
    await d.linkAnn();
    expect((await d.call('assistant', 'assistant-inapp', { answer: 'nee' }, PRIVATE)).ok).toBe(true);
    expect(d.invited).toEqual([]);
    const yes = await d.call('assistant', 'assistant-inapp', { answer: 'ja' }, PRIVATE);
    expect(yes.ok, JSON.stringify(yes)).toBe(true);
    expect(d.invited).toEqual([KEY]);
    expect(yes.message).toContain('onderling-invite://');
  });
  it('no invite from a group, before linking, or with the setting off', async () => {
    const off = await door();
    await off.linkAnn();
    expect((await off.call('assistant', 'assistant-inapp', { answer: 'ja' }, PRIVATE)).ok).toBe(false);
    const d = await door({ setting: 'on' });
    expect((await d.call('assistant', 'assistant-inapp', { answer: 'ja' }, PRIVATE)).ok).toBe(false);   // not linked yet
    await d.linkAnn();
    expect((await d.call('assistant', 'assistant-inapp', { answer: 'ja' }, GROUP)).ok).toBe(false);
    expect((await d.call('assistant', 'assistant-inapp', { answer: 'ja' }, { ...PRIVATE, via: 'screen' })).ok).toBe(false);
    expect(d.invited).toEqual([]);
  });
});

describe('/revoke', () => {
  it('evicts the person from the household\'s circle too (by the key they linked); someone never linked: nothing to evict', async () => {
    const d = await door({ setting: 'on' });
    await d.linkAnn();
    const r = await d.call('assistant', 'assistant-revoke', { who: 'Ann' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(d.evicted).toEqual([KEY]);
    expect(r.message).toContain('circle.bot.revoked_circle');
    const d2 = await door({ setting: 'on' });
    await d2.call('assistant', 'assistant-revoke', { who: 'Ann' }, { caller: ADMIN, threadId: ADMIN, chatId: '9' });
    expect(d2.evicted).toEqual([]);
  });
});

describe('whose key', () => {
  it('a door row: the key its /koppel linked; an inbox row: its own id (the book does not repeat it); none: null', () => {
    expect(linkedKeyOf({ id: 'telegram:42', channel: 'telegram', pubKey: 'K' })).toBe('K');
    expect(linkedKeyOf({ id: 'telegram:42', channel: 'telegram' })).toBeNull();
    expect(linkedKeyOf({ id: 'ANN-KEY', channel: 'web' })).toBe('ANN-KEY');
    expect(linkedKeyOf(null)).toBeNull();
  });
});
