/**
 * A WEB POD SIGN-IN AGAINST A COMMUNITY SOLID SERVER COMPLETES — through the app's own sign-in (the redirect a person
 * takes: the issuer's login page, its consent, back to the app), and the app then holds the session: `whoami` says
 * signed in, at the WebID the pod issued, and no sign-in error.
 *
 * It did not, for a while: a CSS registers the app's client as never expiring (`client_secret_expires_at: 0`, RFC 7591),
 * and the browser auth library read that as expired and failed the redirect ("Client registration failed."). The library
 * reads it as never-expiring from 3.x on. A failure here is said by `whoami`'s `signInError` — the test prints it.
 *
 *   PEER_TEST_PORT=5273 PEER_TEST_RELAY=ws://127.0.0.1:8797 npx playwright test --project=relay test-browser/walk-pod-signin.spec.js
 */
import { test, expect } from '@playwright/test';
import { bootCss, teardown as podTeardown, provisionAll } from '../../../scripts/css-harness.mjs';
import { bootPeers, teardown } from './peerHarness.js';

test.setTimeout(300_000);

test('a web pod sign-in against a CSS pod completes and the app holds the session', async ({ browser }) => {
  const base = 'http://localhost:3064/';
  const css = await bootCss({ port: 3064, base, config: '@css:config/file-acp.json' });
  const peers = await bootPeers(browser, 1);
  const page = peers[0].page;
  try {
    await provisionAll(base, 'si');
    await page.evaluate((iss) => { window.onderlingPodSignIn(iss); }, base);
    await page.waitForURL((u) => u.href.startsWith(base), { timeout: 30_000 });
    const pw = page.locator('a[href*="login/password"]');
    if (!(await page.locator('#email').isVisible().catch(() => false)) && await pw.count()) await pw.first().click();
    await page.locator('#email').fill('siown@ex.com');
    await page.locator('#password').fill('pw-123456');
    await page.locator('button[type="submit"][name="submit"]').click();
    await page.locator('#authorize').waitFor({ timeout: 30_000 });
    await expect(page.locator('#authorize')).toBeEnabled({ timeout: 15_000 });
    await page.locator('#authorize').click();
    await page.waitForURL((u) => !u.href.startsWith(base), { timeout: 60_000 });
    const who = () => page.evaluate(() => window.onderlingCall?.('basis', 'whoami', {}));
    await expect.poll(async () => (await who())?.signedIn ?? false, {
      timeout: 60_000, intervals: [1000], message: 'the app holds no pod session after the redirect',
    }).toBe(true);
    const r = await who();
    expect(r.signInError ?? null, `the sign-in reported an error: ${r.signInError}`).toBe(null);
    expect(r.webid).toBe(`${base}siown/profile/card#me`);
  } finally {
    await teardown(peers);
    try { podTeardown(css); } catch { /* best-effort */ }
  }
});
