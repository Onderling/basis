/**
 * A BOT FILED UNDER A PERSONA IS LINKED AS THAT PERSONA. The identity-link offer (`/koppel`) and every turn's statement to
 * a linked bot are signed by the self the bot contact is filed under: a persona's chat key and ITS delegation (its own
 * device key under its own authority) — never this device's general delegation, which would tell the persona's bot who
 * the person's general self is. A bot filed under the general persona is linked as before.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { EventLog } from '../src/eventLog.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';
import { parseLinkOffer, encodeLinkStartLink, IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';
import { createIdentityLinks } from '../src/v2/identityLinkView.js';

describe('a persona links its own bot', () => {
  let agent;
  afterAll(async () => { await agent?.shutdown?.(); });

  it("the offer and the turn statements to W's bot are W's; the general persona's bot keeps the general root", async () => {
    agent = await createRealHouseholdAgent({ seedHousehold: false, ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), registryBackend: createMemoryBackend(), deviceLog: new EventLog({ initial: [], muted: [] }) });
    const w = (await agent.callSkill('agents', 'createProfile', { name: 'Werk' })).id;
    const W = agent.persona(w);
    const wRoot = W.enrolledDevice?.record?.by;
    const generalRoot = agent.persona('default').enrolledDevice?.record?.by;
    expect(wRoot && generalRoot && wRoot !== generalRoot, 'W has its own authority').toBe(true);

    const wBot = 'bot:werk-assistent';
    const homeBot = 'bot:huis-assistent';
    await agent.callSkill('pinboard', 'addContact', { webid: wBot, pubKey: wBot, peerAddr: wBot, displayName: 'Werkbot', bot: true, persona: w });
    await agent.callSkill('pinboard', 'addContact', { webid: homeBot, pubKey: homeBot, peerAddr: homeBot, displayName: 'Huisbot', bot: true });

    const wOffer = parseLinkOffer((await agent.signLinkOffer({ botAddress: wBot })).offer);
    expect(wOffer.ok, JSON.stringify(wOffer)).toBe(true);
    expect(wOffer.webid ?? wOffer.w, 'the offer speaks as W').toBe(W.chatId.pubKey);
    expect(wOffer.root ?? wOffer.k, "W's own root, never the general one").toBe(wRoot);
    const homeOffer = parseLinkOffer((await agent.signLinkOffer({ botAddress: homeBot })).offer);
    expect(homeOffer.root ?? homeOffer.k, 'the general bot: the general root, as before').toBe(generalRoot);

    // a turn to W's bot once linked: the statement is W's delegation's
    await agent.callSkill('pinboard', 'addContact', { webid: wBot, linkedRow: 'row-1', linkedAt: Date.now() });
    const auth = await agent.linkedTurnAuth(wBot, { text: 'hoi', messageId: 'm1' });
    expect(auth?.delegation?.by, "the turn is signed under W's authority").toBe(wRoot);
  }, 60_000);

  it('a link statement is taken for the root the offer was made from, never another of this device\'s roots', async () => {
    const added = [];
    const links = createIdentityLinks({
      signOffer: async () => ({ offer: 'onderling-link://x', nonce: 'n', root: 'root-W' }),
      selfRoots: () => ['root-general', 'root-W'],
      callSkill: async (app, op, args) => { if (op === 'addContact') added.push(args); return { ok: true }; },
    });
    expect((await links.view(encodeLinkStartLink('https://basis.example/app', { botAddress: 'bot:w', botName: 'Werkbot' })).offer()).ok).toBe(true);
    // the bot answers naming the GENERAL root — another of ours, not the one the offer was made from
    expect(await links.received('bot:w', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'bot:w', row: 'r1', root: 'root-general' } })).toBe(false);
    expect(await links.received('bot:w', { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: 'bot:w', row: 'r1', root: 'root-W' } })).toBe(true);
    expect(added.map((a) => a.linkedRow)).toEqual(['r1']);
  });
});
