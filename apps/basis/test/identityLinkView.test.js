/**
 * The app's side of `/koppel`, shared by every shell: the start link read (which bot), the offer made by THIS DEVICE
 * (its statement; the code is the one the bot will ask for), and the bot's statement kept as a CONTACT-BOOK ROW — only
 * from the bot this device offered to, only about this person's root. An unlink statement clears the mark. Nothing in
 * browser storage: the book is what both shells read, and it carries to the person's other devices.
 */
import { describe, it, expect } from 'vitest';
import { createIdentityLinks } from '../src/v2/identityLinkView.js';
import { encodeLinkStartLink, parseLinkOffer, linkCode, IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';
import { linkedPerson } from './support/linkedPerson.js';

const ME = await linkedPerson();
const LINK = encodeLinkStartLink('https://basis.example/app', { botAddress: 'BOT', relayUrl: 'wss://r', botName: '@huisbot' });

function book() {
  const rows = new Map();
  const callSkill = async (app, op, args) => {
    if (app === 'stoop' && op === 'listContacts') return { contacts: [...rows.values()] };
    if (app === 'stoop' && op === 'addContact') { rows.set(args.webid, { ...(rows.get(args.webid) ?? {}), ...args }); return { contact: rows.get(args.webid) }; }
    return null;
  };
  return { rows, callSkill };
}
const links = (b) => createIdentityLinks({
  signOffer: async ({ botAddress }) => ME.offer('phone', botAddress),
  selfRoot: () => ME.root,
  callSkill: b.callSkill,
  now: () => 1234,
});
const statement = (o = {}) => ({ subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'BOT', row: 'telegram:42', root: ME.root, ...o } });

describe('the app\'s side of the identity link', () => {
  it('reads which bot; the offer is this device\'s statement for that bot; the code matches the bot\'s', async () => {
    const v = links(book()).view(LINK);
    expect(v.bot).toMatchObject({ ok: true, botAddress: 'BOT', botName: '@huisbot' });
    expect(v.label).toBe('@huisbot (BOT…)');
    const made = await v.offer();
    expect(made.ok).toBe(true);
    expect(made.line.startsWith('/koppel ')).toBe(true);
    const o = parseLinkOffer(made.line.slice('/koppel '.length));
    expect(o).toMatchObject({ ok: true, root: ME.root, webid: ME.webid, botAddress: 'BOT' });
    expect(made.code).toBe(await linkCode(ME.root, o.nonce));
  });

  it('a device that cannot sign makes no offer, and says so', async () => {
    const b = book();
    const l = createIdentityLinks({ signOffer: async () => null, selfRoot: () => ME.root, callSkill: b.callSkill });
    expect(await l.view(LINK).offer()).toEqual({ ok: false, reason: 'no-device-key' });
    // …and waits for nobody
    expect(await l.received('BOT', statement())).toBe(false);
  });

  it('the bot\'s statement makes the bot a contact — from the bot offered to, about this root; another bot or root is not kept', async () => {
    const b = book();
    const l = links(b);
    const heard = [];
    l.onLinked((e) => heard.push(e));
    expect(await l.received('BOT', statement()), 'no offer made yet').toBe(false);
    await l.view(LINK).offer();
    expect(await l.received('SOMEONE', statement({ bot: 'SOMEONE' }))).toBe(false);
    expect(await l.received('BOT', statement({ root: 'ANOTHER-ROOT' }))).toBe(false);
    expect(await l.received('SOMEONE', statement()), 'the statement must name its sender').toBe(false);
    expect(await l.received('BOT', statement())).toBe(true);
    expect(b.rows.get('BOT')).toEqual({ webid: 'BOT', pubKey: 'BOT', peerAddr: 'BOT', displayName: '@huisbot', linkedRow: 'telegram:42', linkedAt: 1234 });
    expect(heard).toEqual([{ bot: 'BOT', row: 'telegram:42', botName: '@huisbot' }]);
    // the offer was answered: a second statement is not taken on its word
    expect(await l.received('BOT', statement({ row: 'telegram:7' }))).toBe(false);
  });

  it('an unlink clears the mark on a bot held as linked (the contact stays); for anyone else it is nothing', async () => {
    const b = book();
    const l = links(b);
    expect(await l.received('BOT', { ...statement(), unlinked: true }), 'not linked here').toBe(false);
    await l.view(LINK).offer();
    await l.received('BOT', statement());
    expect(await l.received('BOT', { ...statement({ root: 'ANOTHER-ROOT' }), unlinked: true })).toBe(false);
    expect(await l.received('BOT', { ...statement(), unlinked: true })).toBe(true);
    expect(b.rows.get('BOT')).toMatchObject({ webid: 'BOT', linkedRow: null, linkedAt: 1234 });
  });

  it('the peer router\'s entry is the subtype, and it takes the statement', async () => {
    const b = book();
    const l = links(b);
    expect(Object.keys(l.handlers)).toEqual([IDENTITY_LINK_SUBTYPE]);
    await l.view(LINK).offer();
    l.handlers[IDENTITY_LINK_SUBTYPE]('BOT', statement());
    await new Promise((r) => { setTimeout(r, 10); });
    expect(b.rows.get('BOT')?.linkedRow).toBe('telegram:42');
  });
});
