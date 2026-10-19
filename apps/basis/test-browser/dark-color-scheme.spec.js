/**
 * DARK MODE TELLS THE BROWSER THE PAGE IS DARK. `theme.css` had the dark palette but no `color-scheme`, so every
 * NATIVE control — a `<select>` and its option list, the date/time pickers, `<dialog>` backdrops, scrollbars — kept
 * the browser's light rendering: white menus with grey text in a dark app (Frits, 2026-10-19). The page now declares
 * its scheme: dark under the OS's dark preference, and the explicit choice (`data-theme`) wins either way.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(60_000);

const schemeOfSelect = (page) => page.evaluate(() => {
  const s = document.createElement('select');
  s.innerHTML = '<option>een</option>';
  document.body.appendChild(s);
  const v = getComputedStyle(s).colorScheme;
  s.remove();
  return v;
});

test('a native control is dark when the page is: the OS preference, and the explicit theme either way', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('.circle-vandaag__head')).toHaveCount(1, { timeout: 30_000 });
  expect(await schemeOfSelect(page), 'OS dark, no explicit theme → the controls are dark').toBe('dark');

  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
  expect(await schemeOfSelect(page), 'the explicit light theme wins over the OS').toBe('light');

  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  expect(await schemeOfSelect(page), 'the explicit dark theme wins over a light OS').toBe('dark');
});
