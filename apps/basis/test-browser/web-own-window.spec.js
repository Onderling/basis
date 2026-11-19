/**
 * The web app in a real browser under its own script policy, and framed (ledger L1041).
 *
 * @guard the web app boots under its script policy with no policy violation and NKN present; framed by another page the main app refuses and says why, and a screen address starts (Telegram shows the screen in a frame)
 */
import { test, expect } from '@playwright/test';

test('boots under its script policy: no violation, NKN from its own origin', async ({ page }, ti) => {
  const violations = []; const errors = [];
  page.on('console', (m) => { if (/Content Security Policy|Content-Security-Policy/i.test(m.text())) violations.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${ti.project.use.baseURL}/`);
  await expect(page.locator('#circle-root')).not.toBeEmpty({ timeout: 30_000 });
  expect(await page.evaluate(() => typeof window.nkn)).toBe('object');
  expect(violations, violations.join('\n')).toEqual([]);
  expect(errors, errors.join('\n')).toEqual([]);
});

test('framed by another page: it does not start and says why', async ({ page }, ti) => {
  const app = `${ti.project.use.baseURL}/`;
  await page.setContent(`<iframe id="f" src="${app}" style="width:800px;height:600px"></iframe>`);
  const frame = page.frameLocator('#f');
  await expect(frame.locator('[data-framed="refused"]')).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator('#circle-root')).toHaveCount(0);
});

test('framed, a SCREEN address starts all the same (a Telegram client shows the screen in a frame)', async ({ page }, ti) => {
  const screen = `${ti.project.use.baseURL}/#scherm=not-a-real-link`;
  await page.setContent(`<iframe id="f" src="${screen}" style="width:800px;height:600px"></iframe>`);
  const frame = page.frameLocator('#f');
  // the screen shell ran: it read the address and said it is not a link (no refusal)
  await expect(frame.locator('[data-screen="invalid"]')).toBeVisible({ timeout: 30_000 });
  await expect(frame.locator('[data-framed="refused"]')).toHaveCount(0);
});
