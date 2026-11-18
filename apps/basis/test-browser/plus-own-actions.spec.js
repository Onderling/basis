/**
 * THE PERSON'S OWN "+" IN THEIR OWN RECORD (ledger L203; the assistant plan's stories 4 and 5). The "+" is a door: what
 * its plain reading runs is recorded by `phrase`, what its model proposes by `model`, a "/" line by `slash`; a proposal
 * the person turns down is recorded as `declined`, a line it could place nowhere as `no_act`. Never the words.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-own-actions.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

const rows = (page) => page.evaluate(() => window.onderlingOwnActions?.() ?? null);
const openPlus = async (page) => { await page.locator('.circle-vandaag__plus').click(); };
const say = async (page, line) => {
  const before = await page.locator('.circle-vandaag-plus__turn').count();
  await page.locator('.circle-vandaag-plus__line').fill(line);
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(page.locator('.circle-vandaag-plus__turn')).toHaveCount(before + 2, { timeout: 15_000 });
};
const since = async (page, start) => ((await rows(page)) ?? []).slice(start.length).map((r) => `${r.app}.${r.op}:${r.door}:${r.outcome}`);

test('story 4: with no model, "zet melk op de boodschappen" puts melk on her own list, and the record says: by phrase', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const start = (await rows(page)) ?? [];
  await openPlus(page);
  await say(page, 'nieuwe lijst boodschappen');
  await say(page, 'zet melk op de boodschappen');
  await expect.poll(() => since(page, start), { timeout: 10_000 }).toEqual([
    'lists.createList:phrase:ok',
    'lists.addToList:phrase:ok',
  ]);
  expect(JSON.stringify(await rows(page)), 'never the words').not.toMatch(/melk|boodschappen/);
});

test('story 5, the "no": a line the "+" can only propose (a list that does not exist) is declined on the card: noted, nothing made; a line placed nowhere is no_act', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const start = (await rows(page)) ?? [];
  await openPlus(page);
  const card = page.locator('.circle-vandaag-plus__card');
  await page.locator('.circle-vandaag-plus__line').fill('zet melk op vakantiespullen');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator('.circle-vandaag-plus__card-no').click();
  await say(page, 'qwerty zxcv');                                // no model set: placed nowhere
  await expect.poll(() => since(page, start), { timeout: 10_000 }).toEqual([
    'lists.createList:phrase:declined',
    'null.null:phrase:no_act',
  ]);
  expect(JSON.stringify(await rows(page)), 'never the words').not.toMatch(/melk|vakantie|qwerty/);
});

test('story 5, the "yes": a proposal accepted on the card keeps the door the line came through (yes and no name the same door)', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const start = (await rows(page)) ?? [];
  await openPlus(page);
  const card = page.locator('.circle-vandaag-plus__card');
  await page.locator('.circle-vandaag-plus__line').fill('zet melk op vakantiespullen');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator('.circle-vandaag-plus__card-in').first().click();   // yes: make the list, and melk on it
  await expect.poll(() => since(page, start), { timeout: 10_000 }).toEqual([
    'lists.createList:phrase:ok',
    'lists.addToList:phrase:ok',
  ]);
});
