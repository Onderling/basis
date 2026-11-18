import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

// /transports says the transport mode by its label ("Connection point (default)", "Both", "NKN"), never the value
// 'relay': a person never reads that word (Frits, 2026-11-17). The connection point's address may follow it.
test.setTimeout(60000);

test('/transports names the mode by its label', async ({ page }) => {
  await bootCircle(page, 'Transports Line');
  await page.locator('.circle-view__composer-input').fill('/transports');
  await page.locator('.circle-view__composer-send').click();
  const line = page.getByText(/^Transport (NKN|Connection point \(default\)|Both|Verbindingspunt \(standaard\)|Beide) · /);
  await expect(line.first()).toBeVisible({ timeout: 10_000 });
  const text = (await line.first().textContent()) ?? '';
  expect(text.split(' · ')[0]).not.toMatch(/relay/i);
});
