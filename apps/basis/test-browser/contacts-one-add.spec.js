/**
 * Contacten has ONE add button (Frits 2026-11-20): what is pasted says what it is. A bot's peer address is asked about
 * first, by its name, and nothing is added before the yes; a "no" adds nothing.
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/contacts-one-add.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const ADDR = `${'Q'.repeat(43)}|Proefbot`;

async function openContacts(page) {
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
  await page.locator('[data-tab="contacten"]').first().click();
  await expect(page.locator('.cc-contacts__add')).toHaveCount(1);
}

test('one add button: a bot address is confirmed by its name, then added', async ({ page }) => {
  await openContacts(page);
  const asked = [];
  page.on('dialog', async (d) => {
    asked.push({ type: d.type(), message: d.message() });
    if (d.type() === 'prompt') await d.accept(ADDR);
    else await d.accept();
  });
  await page.locator('.cc-contacts__add').click();
  await expect.poll(() => asked.find((a) => a.type === 'confirm')?.message ?? '', { timeout: 10_000 }).toContain('Proefbot');
  await expect(page.locator('body')).toContainText('Proefbot', { timeout: 15_000 });
});

test('a no at the question adds nothing', async ({ page }) => {
  await openContacts(page);
  page.on('dialog', async (d) => {
    if (d.type() === 'prompt') await d.accept(ADDR);
    else await d.dismiss();
  });
  await page.locator('.cc-contacts__add').click();
  await page.waitForTimeout(1_500);
  await expect(page.locator('.cc-contacts')).not.toContainText('Proefbot');
});
