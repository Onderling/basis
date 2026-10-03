/**
 * The app's side of `/koppel`: the start link read (which bot), an offer written with the person's OWN key (the chat
 * identity — the same on every device of theirs), the code the bot will ask for, and the bot's statement kept once it
 * arrives — only from the bot the offer was for, only about this person's key. An unlink statement drops it.
 */
import { describe, it, expect } from 'vitest';
import { createIdentityLinkView } from '../src/v2/identityLinkView.js';
import { encodeLinkStartLink, parseLinkOffer, linkCode, linkOfferMessage, IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';
import { AgentIdentity, b64encode } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const ME_ID = await AgentIdentity.generate(new VaultMemory());
const ME = ME_ID.pubKey;
// the agent's narrow signer, as realAgent builds it
const signOffer = ({ botAddress, nonce }) => b64encode(ME_ID.sign(linkOfferMessage({ k: ME, b: botAddress, n: nonce })));

const store = () => { const m = new Map(); return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }; };
const LINK = encodeLinkStartLink('https://basis.example/app', { botAddress: 'BOT', relayUrl: 'wss://r', botName: '@huisbot' });

describe('the app\'s side of the identity link', () => {
  it('reads which bot; writes an offer with the person\'s key for that bot; the code matches the bot\'s', async () => {
    const v = createIdentityLinkView({ link: LINK, personKey: ME, signOffer, storage: store() });
    expect(v.bot).toMatchObject({ ok: true, botAddress: 'BOT', botName: '@huisbot' });
    const { line, code } = await v.offer();
    expect(line.startsWith('/koppel ')).toBe(true);
    const o = parseLinkOffer(line.slice('/koppel '.length));
    expect(o).toMatchObject({ ok: true, personKey: ME, botAddress: 'BOT' });   // and its signature verified
    expect(code).toBe(await linkCode(ME, o.nonce));
  });

  it('keeps the statement from that bot about this key; ignores another key\'s or another bot\'s; an unlink drops it', async () => {
    const s = store();
    const v = createIdentityLinkView({ link: LINK, personKey: ME, signOffer, storage: s });
    await v.offer();
    expect(v.received('SOMEONE', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'SOMEONE', row: 'telegram:42', key: ME } })).toBe(false);
    expect(v.received('BOT', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'BOT', row: 'telegram:42', key: 'OTHER' } })).toBe(false);
    expect(v.received('BOT', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'BOT', row: 'telegram:42', key: ME } })).toBe(true);
    expect(createIdentityLinkView({ link: '', personKey: ME, signOffer, storage: s }).linkedTo()).toEqual([{ bot: 'BOT', row: 'telegram:42', botName: '@huisbot' }]);
    expect(v.received('BOT', { subtype: IDENTITY_LINK_SUBTYPE, unlinked: true, statement: { bot: 'BOT', row: 'telegram:42', key: ME } })).toBe(true);
    expect(v.linkedTo()).toEqual([]);
  });

  it('a statement for a bot this app never offered to is not kept (it grants nothing, but it is not ours)', () => {
    const v = createIdentityLinkView({ link: '', personKey: ME, signOffer, storage: store() });
    expect(v.received('BOT', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'BOT', row: 'telegram:42', key: ME } })).toBe(false);
  });
});
