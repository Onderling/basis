/**
 * THE IDENTITY LINK IN THE PERSON'S OWN APP — the real agent, over a real relay, a stand-in bot on the same relay (the
 * bot's checks are the door's tests; the walk drives the real box).
 *
 *   - the offer is THIS DEVICE's statement for that bot (its delegation key, the root-signed delegation beside it), and
 *     its code is the one the bot will ask for;
 *   - the bot's statement makes the bot a CONTACT in the person's book (a keyed row, marked with the row there) — what
 *     both shells read, nothing in browser storage; only from the bot an offer was made for, about this person's root;
 *   - a turn to that bot carries this device's statement over exactly that turn; a turn to anyone else carries none;
 *   - revoking a device tells the linked bot: the root's own tombstone;
 *   - the bot's unlink statement clears the mark.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deviceDelegationsOf } from '@onderling/agent-registry';
import { verifyDeviceRevocation } from '@onderling/core';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, connectNodesOverRelay, teardown, until } from './support/pairRealAgents.js';
import {
  encodeLinkStartLink, parseLinkOffer, verifyLinkStatement, linkCode, IDENTITY_LINK_SUBTYPE, IDENTITY_LINK_REVOKE_SUBTYPE, LINK_OPS,
} from '../src/v2/identityLink.js';

describe('the identity link in the person\'s app', () => {
  let relay; let web; let bot; let other;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    web = await bootRealAgentNode('web', { contactChannel: true });
    bot = await bootRealAgentNode('bot');
    other = await bootRealAgentNode('other');
    await connectNodesOverRelay([web, bot, other], { relayUrl: relay.url });
  }, 90_000);
  afterAll(async () => {
    try { await teardown([web, bot, other]); } catch { /* */ }
    try { await relay?.close?.(); } catch { /* */ }
  });

  const contacts = async () => (await web.agent.callSkill('stoop', 'listContacts', {}))?.contacts ?? [];
  const props = async () => (await web.agent.callSkill('agents', 'getProfileProperties', { id: 'default' }))?.properties ?? {};
  const myRoot = async () => [...new Set(Object.values(deviceDelegationsOf({ properties: await props() })).map((d) => d.by))][0];
  const said = (node, subtype) => node.received.filter((m) => m.payload?.subtype === subtype);

  it('the offer is this device\'s statement for that bot; the bot\'s statement makes the bot a contact — on this device\'s word only', async () => {
    const view = web.agent.identityLinks.view(encodeLinkStartLink('https://basis.example/app', { botAddress: bot.pubKey, relayUrl: relay.url, botName: '@huisbot' }));
    expect(view.bot).toMatchObject({ ok: true, botAddress: bot.pubKey });
    expect(view.label).toContain('@huisbot');
    const made = await view.offer();
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const o = parseLinkOffer(made.line.replace(/^\/koppel\s+/, ''));
    expect(o).toMatchObject({ ok: true, botAddress: bot.pubKey, webid: web.pubKey });
    const root = await myRoot();
    expect(o.root).toBe(root);
    expect(verifyLinkStatement(o.statement, { node: bot.pubKey, op: LINK_OPS.LINK, args: { w: web.pubKey }, root })).toMatchObject({ ok: true, root });
    expect(made.code).toBe(await linkCode(root, o.nonce));

    // a bot no offer was made for, and a statement about another root: not kept
    await other.agent.sendPeerMessage(web.pubKey, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: other.pubKey, row: 'telegram:1', root, at: Date.now() } });
    await bot.agent.sendPeerMessage(web.pubKey, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: bot.pubKey, row: 'telegram:9', root: 'ANOTHER-ROOT', at: Date.now() } });
    // the real one
    await bot.agent.sendPeerMessage(web.pubKey, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: bot.pubKey, row: 'telegram:9', root, at: Date.now() } });
    const row = await until(async () => (await contacts()).find((c) => c.webid === bot.pubKey && c.linkedRow) ?? null, { timeout: 20_000, step: 200 });
    expect(row, 'the bot is a contact in the book').toMatchObject({ webid: bot.pubKey, peerAddr: bot.pubKey, linkedRow: 'telegram:9', displayName: '@huisbot' });
    expect((await contacts()).some((c) => c.webid === other.pubKey && c.linkedRow)).toBe(false);
  }, 60_000);

  it('a turn to the linked bot carries this device\'s statement over exactly that turn; a turn to anyone else carries none', async () => {
    const root = await myRoot();
    const sent = web.contactThreadChannel.sendTurn({ peerAddr: bot.pubKey, threadId: bot.pubKey, text: 'zet melk op de lijst' });
    await sent.sent;
    const turn = await until(async () => said(bot, 'contact-msg').find((m) => m.payload.messageId === sent.messageId) ?? null, { timeout: 20_000, step: 200 });
    expect(turn?.payload?.auth, 'the turn carries a statement').toBeTruthy();
    expect(verifyLinkStatement(turn.payload.auth, { node: bot.pubKey, op: LINK_OPS.TURN, args: { text: 'zet melk op de lijst', messageId: sent.messageId }, root }))
      .toMatchObject({ ok: true, root });
    const plain = web.contactThreadChannel.sendTurn({ peerAddr: other.pubKey, threadId: other.pubKey, text: 'hoi' });
    await plain.sent;
    const toOther = await until(async () => said(other, 'contact-msg').find((m) => m.payload.messageId === plain.messageId) ?? null, { timeout: 20_000, step: 200 });
    expect(toOther?.payload?.auth, 'no statement for someone who is not a linked bot').toBeUndefined();
  }, 60_000);

  it('revoking a device tells the linked bot — the root\'s own tombstone', async () => {
    const root = await myRoot();
    const phrase = (await web.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const r = await web.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'lost-phone' });
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, botsTold: 1 });
    const msg = await until(async () => said(bot, IDENTITY_LINK_REVOKE_SUBTYPE)[0] ?? null, { timeout: 20_000, step: 200 });
    expect(msg.payload.revocation).toMatchObject({ deviceId: 'lost-phone', by: root });
    expect(verifyDeviceRevocation(msg.payload.revocation, root)).toBe(true);
    expect(said(other, IDENTITY_LINK_REVOKE_SUBTYPE), 'nobody else is told').toEqual([]);
  }, 60_000);

  it('the bot\'s unlink statement clears the mark (the contact stays)', async () => {
    const root = await myRoot();
    await bot.agent.sendPeerMessage(web.pubKey, { subtype: IDENTITY_LINK_SUBTYPE, unlinked: true, statement: { bot: bot.pubKey, row: 'telegram:9', root, at: Date.now() } });
    const row = await until(async () => { const c = (await contacts()).find((x) => x.webid === bot.pubKey); return c && !c.linkedRow ? c : null; }, { timeout: 20_000, step: 200 });
    expect(row).toMatchObject({ webid: bot.pubKey });
    expect(row.linkedRow ?? null).toBeNull();
  }, 60_000);
});
