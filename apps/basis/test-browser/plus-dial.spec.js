/**
 * THE "+" DOCKED IN THE TAB BAR, OPENING INTO ROUND BUTTONS, ON THE REAL WEB APP. One tap opens it (Chat on its own spot,
 * Scan and My QR around it); a touch outside or Escape folds it back; a double tap lands in the person's own
 * conversation; My QR opens the share-my-contact view; with nothing in the middle (the setting), a second tap closes.
 *
 *   npx playwright test --project=no-relay test-browser/plus-dial.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const open = async (page) => {
  await expect(page.locator('.circle-vandaag__head'), 'the app opens on Vandaag').toBeVisible({ timeout: 20_000 });
};

test('the "+" sits in the bar between Kringen and Contacten, and opens into Chat · Scan · My QR', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await open(page);
  const order = await page.locator('.circle-tabbar > button').evaluateAll((els) => els.map((b) => b.dataset.tab ?? '+'));
  expect(order.slice(0, 4), 'the + docked in the middle').toEqual(['screens', 'circles', '+', 'contacten']);

  const plus = page.locator('.circle-tabbar__plus');
  await plus.click();
  await expect(plus).toHaveAttribute('data-dial', 'chat');
  await expect(page.locator('.circle-plusdial__btn')).toHaveCount(2);
  await expect(page.locator('.circle-plusdial__btn[data-dial="scan"]')).toBeVisible();
  await expect(page.locator('.circle-plusdial__btn[data-dial="share"]')).toBeVisible();

  // Escape folds it back
  await page.keyboard.press('Escape');
  await expect(page.locator('.circle-plusdial')).toHaveCount(0);
  await expect(plus).toHaveText('+');

  // a touch outside the buttons folds it back, and does not press what is under it
  await plus.click();
  await page.mouse.click(20, 200);
  await expect(page.locator('.circle-plusdial')).toHaveCount(0);
  await expect(page.locator('.circle-vandaag__head'), 'still on Vandaag').toBeVisible();

  // a tab while open only closes
  await plus.click();
  await page.locator('[data-tab="circles"]').click({ force: true });
  await expect(page.locator('.circle-plusdial')).toHaveCount(0);
  await expect(page.locator('[data-tab="screens"]')).toHaveClass(/is-active/);

  // a double tap lands in the person's own conversation
  await plus.dblclick();
  await expect(page.locator('.circle-vandaag-plus__line'), 'the "+" conversation').toBeVisible({ timeout: 10_000 });
  expect(errs).toEqual([]);
});

test('My QR opens the share-my-contact view', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await page.locator('.circle-tabbar__plus').click();
  await page.locator('.circle-plusdial__btn[data-dial="share"]').click();
  await expect(page.locator('.cc-share'), 'the card screen').toBeVisible({ timeout: 15_000 });
});

test('with nothing in the middle, a second tap on the "+" closes it', async ({ page }) => {
  await page.goto('/');
  await open(page);
  await page.evaluate(() => window.onderlingCall?.('params', 'set-param', { key: 'plus.middle', value: 'none' }));
  const plus = page.locator('.circle-tabbar__plus');
  await plus.click();
  await expect(page.locator('.circle-plusdial__btn')).toHaveCount(3);
  await plus.click();
  await expect(page.locator('.circle-plusdial')).toHaveCount(0);
  await expect(page.locator('.circle-vandaag-plus__line'), 'no conversation opened').toHaveCount(0);
});
