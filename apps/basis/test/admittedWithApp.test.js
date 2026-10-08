/**
 * The person's app signs only to agents they admitted themselves with. Typing `/start <code>` to a contact whose card
 * says it is a bot is the admission — that one turn is signed and the device waits for the bot's word; the bot's
 * statement is what marks the contact, after which every turn to it is signed. A card's "bot" claim alone earns no
 * statement, and the same text to a person is never signed.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';

const BOT = 'BotAddressBotAddressBotAddressBotAddress123';
const PERSON = 'PersonAddrPersonAddrPersonAddrPersonAddr12';

describe('the app signs only to agents the person admitted with', () => {
  let node;
  afterAll(async () => { try { await teardown([node]); } catch { /* */ } });

  it('a /start <code> to a bot-claiming contact is signed; nothing else is, until the bot\'s statement marks it', async () => {
    node = await bootRealAgentNode('bea', {});
    const a = node.agent;
    await a.callSkill('stoop', 'addContact', { webid: BOT, pubKey: BOT, peerAddr: BOT, displayName: 'Huisbot', bot: true });
    await a.callSkill('stoop', 'addContact', { webid: PERSON, pubKey: PERSON, peerAddr: PERSON, displayName: 'Ann' });

    expect(await a.linkedTurnAuth(BOT, { text: 'hallo', messageId: 'm1' }), 'a claim alone earns nothing').toBeNull();
    expect(await a.linkedTurnAuth(PERSON, { text: '/start ABC123', messageId: 'm2' }), 'the same text to a person').toBeNull();
    const admission = await a.linkedTurnAuth(BOT, { text: '/start ABC123', messageId: 'm3' });
    expect(admission?.delegation?.by, 'the admission turn carries a device statement').toBeTruthy();

    // the bot's word: its statement about this person's root marks the contact
    const root = admission.delegation.by;
    const taken = await a.identityLinks.received(BOT, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: BOT, row: `web:${BOT}`, root, at: Date.now() } });
    expect(taken, 'the statement is taken (this device was waiting for it)').toBe(true);
    expect(await a.linkedTurnAuth(BOT, { text: 'hallo', messageId: 'm4' }), 'from then on every turn is signed').toBeTruthy();
    expect(await a.linkedTurnAuth(PERSON, { text: 'hallo', messageId: 'm5' }), 'a person still never').toBeNull();
  }, 60_000);
});
