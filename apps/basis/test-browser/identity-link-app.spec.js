/**
 * THE IDENTITY LINK IN THE PERSON'S OWN APP, IN A REAL BROWSER — the web app opened from a household bot's `/koppel`
 * link (`#koppel-bot=`): the fragment leaves the address bar, a sheet names the bot and says what linking means, the
 * line to paste is THIS device's statement for that bot (naming the person's root and chat identity), the code is the
 * one the bot will ask for; and when the bot's statement arrives over the relay, the sheet says "linked" and the bot is
 * a CONTACT in the app's book (nothing in browser storage). The bot here is a stand-in agent on the same relay (the
 * door's side is the door's tests; the box walk drives the real one; the real Telegram walk is Frits').
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/identity-link-app.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootRealAgentNode, connectNodesOverRelay, teardown } from '../test/support/pairRealAgents.js';
import { encodeLinkStartLink, parseLinkOffer, linkCode, IDENTITY_LINK_SUBTYPE } from '../src/v2/identityLink.js';

const R1 = process.env.PEER_TEST_RELAY || '';
test.skip(!R1, 'needs PEER_TEST_RELAY');

test('the identity link in the app: the bot named, the line with this app\'s key, the code, "linked" when the bot says so', async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const bot = await bootRealAgentNode('bot');
  try {
    await connectNodesOverRelay([bot], { relayUrl: R1 });
    const link = encodeLinkStartLink(`${testInfo.project.use.baseURL}/`, { botAddress: bot.pubKey, relayUrl: R1, botName: '@huisbot' });
    const ctx = await browser.newContext({ locale: 'nl-NL' });
    const page = await ctx.newPage();
    await page.goto(link);
    const sheet = page.locator('[data-identity-link="sheet"]');
    await expect(sheet).toBeVisible({ timeout: 120_000 });
    await expect(sheet).toContainText('@huisbot');
    expect(page.url()).not.toContain('#koppel-bot=');

    await sheet.locator('[data-identity-link="make"]').click();
    const line = await sheet.locator('[data-identity-link="line"]').inputValue({ timeout: 30_000 });
    const offer = parseLinkOffer(line.replace(/^\/koppel\s+/, ''));
    expect(offer).toMatchObject({ ok: true, botAddress: bot.pubKey });
    await expect(sheet.locator('[data-identity-link="code"]')).toHaveText(await linkCode(offer.root, offer.nonce));

    // the bot's statement, over the relay, to the chat identity in the offer: the sheet says linked, the bot is a contact
    // — which also proves the offer carries THIS app's own identity (the relay delivers to the key it registered)
    await bot.agent.sendPeerMessage(offer.webid, { subtype: IDENTITY_LINK_SUBTYPE, statement: { bot: bot.pubKey, row: 'telegram:42', root: offer.root, at: Date.now() } });
    await expect(sheet.locator('[data-identity-link="linked"]')).toBeVisible({ timeout: 60_000 });
    const book = await page.evaluate(() => window.onderlingCall('stoop', 'listContacts', {}));
    expect((book?.contacts ?? []).find((c) => c.webid === bot.pubKey)).toMatchObject({ linkedRow: 'telegram:42', displayName: '@huisbot' });
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('onderling.identityLink')))).toEqual([]);
    await ctx.close();
  } finally {
    await teardown(bot).catch(() => {});
  }
});
