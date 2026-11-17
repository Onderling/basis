/**
 * THE PERSON BUTTON SITS IN THE APP, NOT OVER THE SITE'S LINE. A hosted build paints the site's "back to …" line above
 * the app (hostFrameBar.js); the header's person button was pinned to the browser window's top and hung half over it.
 * Here the line is put on the page as a hosted build paints it, on a desktop and a phone-sized screen, and the two boxes
 * must not overlap.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/header-avatar-host-line.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 800 }]) {
  test(`at ${size.width}px the person button does not cover the site's line`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.locator('.circle-vandaag__head')).toBeVisible({ timeout: 20_000 });
    const button = page.locator('.cc-header-avatar').first();
    await expect(button).toBeVisible();
    // the site's line, as a hosted build paints it: first in the body, its own class
    await page.evaluate(() => {
      const bar = document.createElement('div');
      bar.className = 'cc-host-frame';
      bar.innerHTML = '<a class="cc-host-frame__link" href="#">← terug naar onderling.org</a>';
      document.body.prepend(bar);
      window.dispatchEvent(new Event('resize'));
    });
    const line = page.locator('.cc-host-frame');
    await expect.poll(async () => {
      const a = await line.boundingBox(); const b = await button.boundingBox();
      return a && b ? b.y >= a.y + a.height : false;
    }, { message: 'the button is below the line', timeout: 5_000 }).toBe(true);
  });
}
