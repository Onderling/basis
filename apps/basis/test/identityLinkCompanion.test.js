/**
 * The person linked as a household bot's ADMIN hands the bot their companion's card, from their app (`grantCompanion`
 * does it in the same act as the grant): one bot op, `assistant-companion {card}`, reached through the bot's one
 * linked-app call (`identity-link.companion`) with a statement from one of the person's devices over exactly that card.
 * The row its root is linked to is the caller, and the door's own call decides as for a typed line: a member's app is
 * refused and nothing is added; the admin's card is a contact of the bot, and the bot's agenda links are built from it.
 */
import { describe, it, expect } from 'vitest';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createBotUsers } from '../src/v2/botUsers.js';
import { createIdentityLink, createLinkTombstones, linkedCompanionSkill } from '../src/v2/botIdentityLink.js';
import { LINKED_COMPANION_OP, LINK_OPS } from '../src/v2/identityLink.js';
import { feedCompanionOf } from '../src/v2/feedCompanion.js';
import { BOT_SCREEN_NEVER } from '../src/v2/screenActing.js';
import { encodeContactCard } from '@onderling-app/stoop/lib/contactCard';
import { linkedPerson } from './support/linkedPerson.js';

const t = (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k);
const BOT = 'BOT-ADDRESS';
const NODE = 'N'.repeat(43);
const card = (o = {}) => `onderling-contact://${encodeContactCard({ webid: NODE, pubKey: NODE, peerAddr: NODE, relays: ['wss://relay.example'], serves: 'https://relay.example', ...o })}`;
function memStore() { const m = new Map(); return { get: async (id) => m.get(id) ?? null, put: async (row) => { m.set(row.id, { ...row }); return row; }, list: async () => [...m.values()] }; }
function memVault() { const m = new Map(); return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } }; }

async function bot() {
  const users = createBotUsers({ store: memStore(), adminUid: '9' });
  await users.admit({ channel: 'telegram', uid: '9', displayName: 'Anne' });   // the admin
  await users.admit({ channel: 'telegram', uid: '42', displayName: 'Ann' });   // a member
  const roles = new Map((await users.list()).map((r) => [r.id, r.role]));
  const contacts = [];
  const link = createIdentityLink({
    users, botAddress: () => BOT, tombstones: createLinkTombstones({ vault: memVault() }),
    ask: async () => ({ ok: true }), sendPrivately: async () => ({ ok: true }), tellApp: async () => {},
    listGrants: async () => [], revokeView: async () => true, where: () => ({}),
  });
  const doorCall = withAssistantOps({
    callSkill: async (app, op, args) => {
      if (app === 'stoop' && op === 'addContactFromQr') { contacts.push(args.payload); return { contact: { webid: NODE } }; }
      if (app === 'stoop' && op === 'listContacts') return { contacts: [] };
      return { ok: true, params: [] };
    },
    t, threads: { langOf: () => null },
    // the host gate, as the box's: an op the assistant manifest declares `trusted` is the admin's alone
    refusal: async (op, caller, level) => (level === 'trusted' && roles.get(caller) !== 'admin' ? { layer: 'tier', code: 'tier-too-low' } : null),
    admin: { users: async () => users.list(), identityLink: link },
  });
  const skill = linkedCompanionSkill({ link, doorCall, id: LINKED_COMPANION_OP });
  const call = (data) => skill.handler({ parts: [{ kind: 'data', data }] });
  return { users, link, call, contacts };
}

describe('a companion\'s card, handed to the bot from the linked person\'s app', () => {
  it('a member\'s app cannot hand the bot a companion card', async () => {
    const ann = await linkedPerson();
    const b = await bot();
    await b.users.linkKey('telegram:42', { root: ann.root, webid: ann.webid });
    const c = card();
    const r = await b.call({ card: c, auth: ann.call('phone', BOT, LINK_OPS.COMPANION, { card: c }) });
    expect(r).toEqual({ ok: false, error: 'not-admin' });
    expect(b.contacts).toEqual([]);
  });

  it('the admin\'s app hands it: the bot holds the companion as a contact — where its agenda links are served', async () => {
    const anne = await linkedPerson();
    const b = await bot();
    await b.users.linkKey('telegram:9', { root: anne.root, webid: anne.webid });
    const c = card();
    expect(await b.call({ card: c, auth: anne.call('laptop', BOT, LINK_OPS.COMPANION, { card: c }) })).toEqual({ ok: true });
    expect(b.contacts).toEqual([c]);
  });

  it('refused before the op: no statement, a statement over another card, a revoked device, nobody linked', async () => {
    const anne = await linkedPerson();
    const b = await bot();
    await b.users.linkKey('telegram:9', { root: anne.root, webid: anne.webid });
    const c = card();
    expect(await b.call({ card: c })).toEqual({ ok: false, error: 'forbidden' });
    expect(await b.call({ card: c, auth: anne.call('phone', BOT, LINK_OPS.COMPANION, { card: card({ serves: 'https://evil.example' }) }) })).toEqual({ ok: false, error: 'forbidden' });
    await b.link.revoked(anne.revocation('old-phone'));
    expect(await b.call({ card: c, auth: anne.call('old-phone', BOT, LINK_OPS.COMPANION, { card: c }) })).toEqual({ ok: false, error: 'forbidden' });
    const stranger = await linkedPerson();
    expect(await b.call({ card: c, auth: stranger.call('phone', BOT, LINK_OPS.COMPANION, { card: c }) })).toEqual({ ok: false, error: 'forbidden' });
    expect(b.contacts).toEqual([]);
  });

  it('a card that is not a companion\'s (it says nowhere its links are served) is refused by the op', async () => {
    const anne = await linkedPerson();
    const b = await bot();
    await b.users.linkKey('telegram:9', { root: anne.root, webid: anne.webid });
    const plain = card({ serves: undefined });
    const r = await b.call({ card: plain, auth: anne.call('phone', BOT, LINK_OPS.COMPANION, { card: plain }) });
    expect(r.ok).toBe(false);
    expect(b.contacts).toEqual([]);
  });

  it('the op is never a screen\'s, has no command of its own, and the card it adds is the bot\'s companion', async () => {
    expect(BOT_SCREEN_NEVER).toContain('assistant.assistant-companion');
    const { assistantManifest } = await import('../src/v2/assistantManifest.js');
    const op = assistantManifest.operations.find((o) => o.id === LINK_OPS.COMPANION);
    expect(op).toMatchObject({ visibility: 'trusted' });
    expect(op.surfaces?.slash).toBeUndefined();
    expect(op.surfaces?.chat).toBeUndefined();
    expect(feedCompanionOf([{ webid: NODE, peerAddr: NODE, serves: 'https://relay.example' }])).toEqual({ node: NODE, base: 'https://relay.example' });
  });
});
