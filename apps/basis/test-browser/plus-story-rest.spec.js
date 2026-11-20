/**
 * THE "+" STORY, THE REST (web): the journeys of the assistant thread that `plus-story.spec.js` does not walk, with the
 * same stand-in model behind the real model interface (src/v2/testModel.js; development builds only).
 *
 *   9.  Whose model: the top of the thread names the route that answers (the person's own, on its host).
 *   5.  A plain phrase: "zet melk op Vakantie" acts at once on the own list, and NO model call is made.
 *   11. Another self: with only "Werk" ticked the thread is empty and nothing of the general self reaches the model;
 *       ticked back, the conversation is there again.
 *   10. It stays: a reload keeps the thread; "Forget" empties it, and the model is no longer handed what was said.
 *   7.  A circle's act: a line two places can take (a circle's list and an own list of one name) gets a card naming
 *       both; nothing runs before the pick; after it, it is on the picked circle's list.
 *   6.  The "/" list: typing "/" offers the door's own commands; picking one opens the same form as its button, and
 *       no model call is made.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-story-rest.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

test.setTimeout(180_000);

const SCRIPT = [
  { when: 'onthoud dat de sleutel', toolCall: { id: '__generic__:household:add:note', args: { body: 'de sleutel bij de buren ligt' } } },
  { when: 'waar ligt de sleutel', replyText: 'Weet ik niet.' },
  { when: 'wat kan je voor me doen', replyText: 'Je eigen notities, afspraken en lijsten.' },
];

const turns = (page) => page.locator('.circle-vandaag-plus__turn');
const openPlus = async (page) => {
  await page.locator('[data-tab="screens"]').first().click().catch(() => {});
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').dblclick();
  await expect(page.locator('.circle-vandaag-plus__line')).toBeVisible();
};
const say = async (page, line) => {
  const before = await turns(page).count();
  await page.locator('.circle-vandaag-plus__line').fill(line);
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(turns(page)).toHaveCount(before + 2, { timeout: 15_000 });
};
const lastAnswer = (page) => page.locator('.circle-vandaag-plus__turn--assistant').last();
const asked = (page) => page.evaluate(() => window.__onderlingTestModel.requests ?? []);
/** everything the model was handed BEFORE this turn's own line: the kept turns */
const historyOf = (req) => JSON.stringify((req?.messages ?? []).slice(0, -1));
/** tick exactly one self in the switcher (the persona panel's "Laat zien als") */
const only = async (page, selfId) => {
  await page.locator('.cc-persona-button__button').click();
  await page.locator('.cc-persona-panel__show-as').click();
  const tick = (id) => page.locator(`.cc-persona-switcher__row[data-self="${id}"] .cc-persona-switcher__tick`);
  if ((await tick(selfId).getAttribute('aria-pressed')) !== 'true') await tick(selfId).click();
  for (const row of await page.locator('.cc-persona-switcher__row').all()) {
    const id = await row.getAttribute('data-self');
    if (id !== selfId && (await tick(id).getAttribute('aria-pressed')) === 'true') await tick(id).click();
  }
  await page.locator('.cc-persona-switcher__close').click();
};

test('the "+" story, the rest: whose model, a plain phrase, another self, it stays', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.addInitScript((script) => { window.__onderlingTestModel = { script }; }, SCRIPT);
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  const werk = await page.evaluate(async () => window.onderlingCall('agents', 'createProfile', { name: 'Werk' }));
  expect(werk?.created, JSON.stringify(werk)).toBe(true);
  await page.reload();
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  // with two selves ticked the "+" first asks which one it writes as: the walk starts as the general self alone
  await only(page, 'default');
  await openPlus(page);

  // 9. whose model: the person's own, named by its host
  await expect(page.locator('.circle-vandaag-plus__route')).toHaveText(/127\.0\.0\.1:11434/);

  // the general self's note, through the conversation (journey 2's way)
  await say(page, 'onthoud dat de sleutel bij de buren ligt');
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(page.locator('.circle-screen__items-row').filter({ hasText: 'de sleutel bij de buren ligt' })).toBeVisible({ timeout: 20_000 });

  // 5. a plain phrase acts at once on the own list, and no model call is made
  await openPlus(page);
  const calls = (await asked(page)).length;
  await say(page, 'nieuwe lijst Vakantie');
  await say(page, 'zet melk op Vakantie');
  await expect(lastAnswer(page)).toContainText('melk');
  expect((await asked(page)).length, 'no model call for a plain phrase').toBe(calls);
  const generalTurns = await turns(page).count();
  await page.locator('.circle-vandaag-plus__close').click();

  // 11. another self: an empty thread, and nothing of the general self reaches the model; ticked back, it is there again
  await only(page, werk.id);
  await openPlus(page);
  await expect(page.locator('.circle-vandaag-plus__thread'), 'Werk has no conversation yet').toHaveCount(0);
  const beforeWerk = (await asked(page)).length;
  await say(page, 'waar ligt de sleutel?');
  expect((await asked(page)).length, "Werk's line reached Werk's model").toBe(beforeWerk + 1);
  const asWerk = JSON.stringify((await asked(page)).at(-1));
  expect(asWerk, "the general self's note is not handed to Werk's model").not.toContain('de sleutel bij de buren ligt');
  expect(asWerk, "the general self's turns are not handed to Werk's model").not.toContain('Vakantie');
  await page.locator('.circle-vandaag-plus__close').click();
  await only(page, 'default');
  await openPlus(page);
  await expect(turns(page), 'the general self\'s conversation is back').toHaveCount(generalTurns, { timeout: 15_000 });

  // 10. it stays: a reload keeps it; Forget empties it, and the model is no longer handed what was said
  await page.waitForTimeout(1500);   // the device log saves on a short debounce
  await page.reload();
  await openPlus(page);
  await expect(turns(page), 'kept across a reload').toHaveCount(generalTurns, { timeout: 15_000 });
  await page.locator('.circle-vandaag-plus__forget').click();
  await expect(page.locator('.circle-vandaag-plus__thread')).toHaveCount(0);
  const beforeAsk = (await asked(page)).length;
  await say(page, 'wat kan je voor me doen?');
  expect((await asked(page)).length, 'the question reached the model').toBe(beforeAsk + 1);
  const after = historyOf((await asked(page)).at(-1));
  expect(after, 'the forgotten turns are not handed to the model').not.toMatch(/onthoud dat de sleutel|Vakantie/);
  expect(errs).toEqual([]);
});

test('the "+" story, a circle\'s act: two places hold the list, the card asks, nothing runs before the pick', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, 'Thuis');
  await page.locator('.circle-view__back').click();
  await page.waitForTimeout(800);
  const tile = page.locator('.circle-tile', { hasText: 'Thuis' }).first();
  const circleId = await tile.getAttribute('data-circle-id');
  expect(circleId).toBeTruthy();
  // the circle's lists on (the admin's setting), and its Boodschappen
  await tile.click();
  await page.waitForTimeout(1500);
  await page.locator('.circle-view__more').click();
  await page.locator('.circle-view__more-item[data-action="settings"]').click();
  const box = page.locator('input[data-feature="lists"]');
  await expect(box).toBeVisible({ timeout: 10_000 });
  if (!(await box.isChecked())) await box.check();
  await page.locator('.circle-settings__save').click();
  await page.waitForTimeout(800);
  const made = await page.evaluate((cid) => window.onderlingCall('lists', 'createList', { circleId: cid, text: 'Boodschappen' }), circleId);
  expect(made?.ok, JSON.stringify(made)).not.toBe(false);
  for (const sel of ['.circle-settings__back', '.circle-view__back']) {
    const b = page.locator(sel);
    if (await b.count()) { await b.first().click(); await page.waitForTimeout(800); }
  }
  const onCircle = async () => ((await page.evaluate((cid) => window.onderlingCall('lists', 'listEntries', { circleId: cid, list: 'Boodschappen' }), circleId))?.items ?? []).map((e) => e.label);

  // an own list of the same name, through the "+"
  await openPlus(page);
  await say(page, 'nieuwe lijst Boodschappen');
  // 7. the line two places can take: the card names both, and nothing runs before the pick
  await page.locator('.circle-vandaag-plus__line').fill('zet kaas op Boodschappen');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  const card = page.locator('.circle-vandaag-plus__card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card.locator('.circle-vandaag-plus__card-in')).toHaveCount(2);
  expect(await onCircle(), 'nothing on the circle before the pick').not.toContain('kaas');
  await card.locator(`.circle-vandaag-plus__card-in[data-circle-id="${circleId}"]`).click();
  await expect.poll(onCircle, { timeout: 15_000 }).toContain('kaas');
  expect(errs).toEqual([]);
});

test('the "+" story, the "/" list: the same acts as the buttons, and picking one opens the same form', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.addInitScript((script) => { window.__onderlingTestModel = { script }; }, SCRIPT);
  await page.goto('/');
  await openPlus(page);
  const calls = (await asked(page)).length;
  await page.locator('.circle-vandaag-plus__line').fill('/');
  const offered = page.locator('.circle-vandaag-plus__suggestion');
  await expect(offered.filter({ hasText: '/addappt' }), 'the appointment act is offered').toHaveCount(1, { timeout: 10_000 });
  await expect(offered.filter({ hasText: '/add-note' }), 'the note act is offered').toHaveCount(1);
  await expect(offered.filter({ hasText: '/whoami' }), 'no device command in the own "+"').toHaveCount(0);
  await offered.filter({ hasText: '/addappt' }).click();
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(page.locator('.circle-vandaag-plus__title'), 'the appointment form, as its button opens it').toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.circle-vandaag-plus__when')).toBeVisible();
  expect((await asked(page)).length, 'no model call for a "/" line').toBe(calls);
  expect(errs).toEqual([]);
});
