/**
 * THE "+" AS A CONVERSATION WITH YOUR OWN ASSISTANT, as the person lives it on web: the journeys of the assistant
 * thread, one after another on one page, with a stand-in model behind the real model interface (src/v2/testModel.js;
 * development builds only). Everything but the model is real: the door, the plain reading, the prompt the engine
 * builds, the tools it hands over, the forms, the thread, the stores.
 *
 *   1. A question: an answer in words, from a model told it is the person's OWN place (no household background).
 *   2. Remember this: a filled note form; nothing is stored until Save; after Save it is on Today.
 *   3. Ask it back: the answer comes from the note (its words reach the model), and nothing changes.
 *   4. A follow-up: "zet dat morgen om 10 in mijn agenda" reaches the model WITH the previous turn; the proposal names
 *      the key; the person closes it: nothing stored, and the thread says so.
 *   8. No model: the same question gets "no model is set", what works without one, and where to set one.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/plus-story.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

// the stand-in model: one answer per line, matched on the newest member message
const SCRIPT = [
  { when: 'wat kan je voor me doen', replyText: 'Ik houd je eigen notities, afspraken en lijsten bij.' },
  { when: 'onthoud dat de sleutel', toolCall: { id: '__generic__:household:add:note', args: { body: 'de sleutel ligt bij de buren' } } },
  { when: 'waar ligt de sleutel', replyText: 'Bij de buren.' },
  { when: 'zet dat morgen om 10', toolCall: { id: 'addEvent', args: { title: 'sleutel ophalen bij de buren' } } },
];

const openPlus = async (page) => { await page.locator('.circle-vandaag__plus').click(); };
const say = async (page, line) => {
  const before = await page.locator('.circle-vandaag-plus__turn').count();
  await page.locator('.circle-vandaag-plus__line').fill(line);
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  // the line and what the "+" answered (or the form it opened, said by its label) are both kept
  await expect(page.locator('.circle-vandaag-plus__turn')).toHaveCount(before + 2, { timeout: 15_000 });
};
const lastAnswer = (page) => page.locator('.circle-vandaag-plus__turn--assistant').last();
const asked = (page) => page.evaluate(() => window.__onderlingTestModel.requests);

test('the "+" story with a model: a question, remember, ask it back, a follow-up refused', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.addInitScript((script) => { window.__onderlingTestModel = { script }; }, SCRIPT);
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await openPlus(page);

  // 1. a question: an answer in words; the model was told it is the person's own place, never a household
  await say(page, 'wat kan je voor me doen?');
  await expect(lastAnswer(page)).toHaveText('Ik houd je eigen notities, afspraken en lijsten bij.');
  const first = (await asked(page)).at(-1);
  expect(first.system, 'the own place says what it is').toMatch(/OWN place/);
  expect(first.system, 'no household bot background').not.toMatch(/Household background|share a household/);

  // 2. remember this: the note form opens filled; nothing is stored until Save; after Save it is on Today
  await say(page, 'onthoud dat de sleutel bij de buren ligt');
  await expect(page.locator('.circle-vandaag-plus__body')).toHaveValue('de sleutel ligt bij de buren');
  const noteRow = page.locator('.circle-screen__items-row').filter({ hasText: 'de sleutel ligt bij de buren' });
  await expect(noteRow, 'nothing stored before Save').toHaveCount(0);
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(noteRow, 'the note is on Today after Save').toBeVisible({ timeout: 20_000 });

  // 3. ask it back: the note's words reach the model; the answer is said; nothing changes
  await openPlus(page);
  await say(page, 'waar ligt de sleutel?');
  await expect(lastAnswer(page)).toHaveText('Bij de buren.');
  expect(JSON.stringify((await asked(page)).at(-1).messages), 'the note reached the model').toContain('de sleutel ligt bij de buren');
  await expect(noteRow).toHaveCount(1);

  // 4. a follow-up: the model gets the previous turn; its proposal names the key; closing it stores nothing, and says so
  await say(page, 'zet dat morgen om 10 in mijn agenda');
  const follow = (await asked(page)).at(-1);
  expect(JSON.stringify(follow.messages), 'the previous turn reached the model').toContain('waar ligt de sleutel');
  await expect(page.locator('.circle-vandaag-plus__title')).toHaveValue('sleutel ophalen bij de buren');
  await page.locator('.circle-vandaag-plus__close').click();
  await expect(page.locator('.circle-screen__agenda-row').filter({ hasText: 'sleutel ophalen' }), 'nothing stored').toHaveCount(0);
  await openPlus(page);
  await expect(lastAnswer(page), 'the thread says it was not saved').toHaveText(/niet bewaard|not saved/i, { timeout: 10_000 });

  expect(errs).toEqual([]);
});

test('the "+" story without a model: the question says no model is set, what works, and where to set one', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await openPlus(page);
  // 9 in part: the top of the thread names the route, here that there is none
  await expect(page.locator('.circle-vandaag-plus__route')).toHaveText(/Geen eigen model|No model of your own/);
  // 8. no model: what works without one, and where to set one
  await say(page, 'wat kan je voor me doen?');
  await expect(lastAnswer(page)).toHaveText(/geen eigen model ingesteld|no model of your own is set/i);
  await expect(lastAnswer(page)).toContainText(/notitie|note/i);
  expect(errs).toEqual([]);
});
