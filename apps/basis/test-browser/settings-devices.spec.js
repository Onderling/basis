/**
 * APPARATEN AND HERSTEL UNDER THE SETTINGS BUTTON (regrouped 2026-11-20). Instellingen → Apparaten holds my devices,
 * adding one, retiring the others, the first contact address, screens, agents, claiming a companion and linking a bot;
 * Herstel holds the recovery phrase, restoring, the recovery file and the personas on this device. Where the data lives
 * (the pod) is in Mijn gegevens. The build's version line is at the foot of Instellingen.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/settings-devices.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(120_000);

test('Apparaten holds the device acts, Herstel the way back, Mijn gegevens the pod; the version line is at the foot', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.cc-persona-button__button')).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  await page.locator('.cc-persona-button__settings').click();
  await page.locator('.cc-settings__group--devices').click();
  for (const id of ['device-add', 'device-replace', 'device-primary', 'companion-claim', 'bot-link']) {
    await expect(page.locator(`[data-section="${id}"]`).first(), id).toBeVisible({ timeout: 15_000 });
  }
  // linking a bot is on the web too now: the field takes a pasted /koppel link, and says when it is none
  await page.locator('.cc-mydata__link-bot').click();
  await page.locator('.cc-mydata__link-bot-input').fill('hallo');
  await page.locator('.cc-mydata__link-bot-go').click();
  await expect(page.locator('.cc-mydata__link-bot-note')).not.toBeEmpty();
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-settings__group--recovery').click();
  for (const id of ['recovery-phrase', 'restore', 'recovery-file', 'personas-receive']) {
    await expect(page.locator(`[data-section="${id}"]`).first(), id).toBeVisible({ timeout: 15_000 });
  }
  await expect(page.locator('[data-section="recovery-file"] .cc-mydata__recovery-export')).toBeVisible();
  await page.locator('.cc-mydata__back').first().click();
  await page.locator('.cc-settings__group--my-data').click();
  await expect(page.locator('[data-section="storage"]').first(), 'the pod is in Mijn gegevens').toBeVisible({ timeout: 15_000 });

  // and the version line sits at the foot of Instellingen
  await page.locator('.cc-mydata__back').first().click();
  await expect(page.locator('.cc-settings__version')).toBeVisible({ timeout: 15_000 });
  expect(errs).toEqual([]);
});
