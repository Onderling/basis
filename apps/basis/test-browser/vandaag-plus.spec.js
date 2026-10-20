/**
 * VANDAAG'S "+", ON A REAL SCREEN (2026-10-15). An own note and an own appointment, made from the "+" beside "Pas aan":
 * each lands in the person's own store and shows on Vandaag tagged as theirs ("jij"/"you") — a page without a notes
 * block gets one, as an ordinary page change.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/vandaag-plus.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

test('the "+" makes an own note and an own appointment, both on Vandaag as mine', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head'), 'the app opens on Vandaag').toBeVisible({ timeout: 20_000 });

  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__act[data-act="household.note"]').click();
  await page.locator('.circle-vandaag-plus__body').fill('sleutel bij de buren');
  await page.locator('.circle-vandaag-plus__save').click();
  const noteRow = page.locator('.circle-screen__items-row').filter({ hasText: 'sleutel bij de buren' });
  await expect(noteRow, 'the own note shows on Vandaag').toBeVisible({ timeout: 20_000 });
  // an own row carries no maker tag (it is the person's own page); a circle's row names its circle
  await expect(noteRow.locator('.circle-screen__tasks-circle')).toHaveCount(0);
  // the page is a day (its header), and no block ever names itself by its type ("items: …")
  await expect(page.locator('.circle-vandaag__day')).not.toBeEmpty();
  await expect(page.locator('.circle-screen__block--empty').filter({ hasText: /^items/i })).toHaveCount(0);

  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__act[data-act="calendar.calendar-event"]').click();
  await page.locator('.circle-vandaag-plus__title').fill('tandarts');
  const when = await page.evaluate(() => { const d = new Date(Date.now() + 86_400_000); d.setHours(14, 0, 0, 0); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T14:00`; });
  await page.locator('.circle-vandaag-plus__when').fill(when);
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(page.locator('.circle-screen__agenda-row').filter({ hasText: 'tandarts' }), 'the own appointment shows').toBeVisible({ timeout: 20_000 });
  // the day's shape: tomorrow's appointment sits in the "tomorrow" group, open (the first group that has any), its moment in words
  const tomorrow = page.locator('.circle-screen__group[data-group="tomorrow"]');
  await expect(tomorrow).toHaveAttribute('open', '');
  await expect(tomorrow.locator('.circle-screen__agenda-row').filter({ hasText: 'tandarts' }).locator('.circle-screen__agenda-moment')).toHaveText('14:00');

  // an empty save says so and makes nothing
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__act[data-act="household.note"]').click();
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(page.locator('.circle-vandaag-plus__error')).toBeVisible();
  expect(errs).toEqual([]);
});

test('the free line fills the sheet; an own row opens it on itself to change or take it away', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });

  // the free line: "afspraak morgen 14:00 kapper" picks the appointment and fills its fields (editable), then Save
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__line').fill('afspraak morgen 14:00 kapper');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(page.locator('.circle-vandaag-plus__form[data-act="calendar.calendar-event"]'), 'the line picked the appointment').toBeVisible();
  await expect(page.locator('.circle-vandaag-plus__title')).toHaveValue('kapper');
  await expect(page.locator('.circle-vandaag-plus__when')).toHaveValue(/T14:00$/);
  await page.locator('.circle-vandaag-plus__save').click();
  const row = page.locator('.circle-screen__agenda-row').filter({ hasText: 'kapper' });
  await expect(row, 'the appointment from the line shows').toBeVisible({ timeout: 20_000 });

  // a line it cannot read says so and fills nothing
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__line').fill('ooit eens iets');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await expect(page.locator('.circle-vandaag-plus__error')).toBeVisible();
  await page.locator('.circle-vandaag-plus__close').click();

  // the own row opens the sheet on itself: change the title, Save; then open again and Remove
  await row.click();
  await expect(page.locator('.circle-vandaag-plus__title')).toHaveValue('kapper');
  await page.locator('.circle-vandaag-plus__title').fill('kapper Jan');
  await page.locator('.circle-vandaag-plus__save').click();
  const changed = page.locator('.circle-screen__agenda-row').filter({ hasText: 'kapper Jan' });
  await expect(changed, 'the change shows').toBeVisible({ timeout: 20_000 });
  await changed.click();
  await page.locator('.circle-vandaag-plus__remove').click();

  // an own NOTE's row opens the sheet on its words too (a listed note carries them as its text)
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__line').fill('notitie: band plakken');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await page.locator('.circle-vandaag-plus__save').click();
  const note = page.locator('.circle-screen__items-row').filter({ hasText: 'band plakken' });
  await expect(note).toBeVisible({ timeout: 20_000 });
  await note.click();
  await expect(page.locator('.circle-vandaag-plus__body'), 'the note opens on its words').toHaveValue('band plakken');
  await page.locator('.circle-vandaag-plus__body').fill('band en ketting');
  await page.locator('.circle-vandaag-plus__save').click();
  await expect(page.locator('.circle-screen__items-row').filter({ hasText: 'band en ketting' }), 'the note changed').toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.circle-screen__agenda-row').filter({ hasText: 'kapper Jan' }), 'taken away').toHaveCount(0, { timeout: 20_000 });
  expect(errs).toEqual([]);
});

test('a Vandaag row is a card with ONE button — the action its noun declares', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('.circle-vandaag__plus').click();
  await page.locator('.circle-vandaag-plus__line').fill('notitie: fietsband plakken');
  await page.locator('.circle-vandaag-plus__line').press('Enter');
  await page.locator('.circle-vandaag-plus__save').click();
  const card = page.locator('.circle-screen__card').filter({ hasText: 'fietsband plakken' });
  await expect(card, 'the own note is a card').toBeVisible({ timeout: 20_000 });
  const act = card.locator('.circle-screen__row-act');
  await expect(act, 'one button on it').toHaveCount(1);
  await expect(act).toHaveAttribute('data-act', 'edit-own');
  await act.click();
  await expect(page.locator('.circle-vandaag-plus__body'), 'the button opens the sheet on the note').toHaveValue('fietsband plakken');
  expect(errs).toEqual([]);
});
