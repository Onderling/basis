/**
 * PAIRING A SCREEN WHEN THIS DEVICE HOLDS TWO SELVES. A persona issues its grants as itself, so the pairing form asks
 * which self the screen is for when the device holds more than one (the active self on Mij comes preselected), and the
 * grant is issued by the self chosen — never a silent default.
 *
 *   PEER_TEST_PORT=5273 npx playwright test -c playwright.config.js --project=no-relay test-browser/connection-pair-as-persona.spec.js
 */
import { test, expect } from '@playwright/test';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { encodePairingOffer } from '../src/v2/connectionPairing.js';

test.setTimeout(150_000);

test('a device with two selves pairs a screen as the self chosen in the form', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('[data-tab="mij"]').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });

  // a second self on this device
  const werk = await page.evaluate(async () => (await window.onderlingCall('agents', 'createProfile', { name: 'Werk' }))?.id ?? null);
  expect(werk, 'Werk was made').toBeTruthy();

  await page.locator('[data-tab="mij"]').first().click();
  await page.locator('.cc-profile__gear').click();
  await page.locator('.cc-settings__group--devices-keys').click();
  const form = page.locator('[data-section="connection-add"]').first();
  await expect(form).toBeVisible({ timeout: 15_000 });

  const view = await AgentIdentity.generate(new VaultMemory());
  await form.locator('.cc-mydata__connection-offer').fill(encodePairingOffer({ viewPubKey: view.pubKey, nonce: 'n-spec', label: 'werkscherm' }));
  // the form asks which self the screen is for
  const self = form.locator('.cc-mydata__connection-self');
  await expect(self, 'the form asks which self the screen is for').toBeVisible({ timeout: 10_000 });
  await self.selectOption(werk);
  await form.locator('.cc-mydata__connection-picker input[type=checkbox]').first().check();
  await form.locator('.cc-mydata__connection-confirm').click();

  const row = await expect.poll(async () => page.evaluate(async (vk) => {
    const r = await window.onderlingCall('household', 'listSurfaceGrants', {});
    return (r?.surfaces ?? []).find((s) => s.viewPubKey === vk) ?? null;
  }, view.pubKey), { timeout: 15_000, message: 'the grant was made' }).not.toBeNull().then(() => page.evaluate(async (vk) => {
    const r = await window.onderlingCall('household', 'listSurfaceGrants', {});
    return (r?.surfaces ?? []).find((s) => s.viewPubKey === vk) ?? null;
  }, view.pubKey));
  expect(row?.persona, 'issued by the self chosen').toBe(werk);
  expect(errs).toEqual([]);
});
