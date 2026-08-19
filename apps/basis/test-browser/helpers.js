/**
 * Shared Playwright helpers for the basis v2 app (index.html / circleApp).
 *
 * (The classic-shell + NKN cross-tab primitives — bootTabs/typeCmd/openThreadByName/waitForNknConnect/
 * expectBubbleSoon — were removed 2026-06-29 when the browser suite migrated off classic.html: their only
 * consumers (mesh-and-dm, multi-device-journeys) were retired, the NKN-cross-tab/DM flows having no v2 surface.)
 *
 * v2 DOM conventions: circle composer `.circle-circle__composer-input` / `.circle-circle__composer-send`,
 * bubbles `.circle-circle__bubble`, launcher `.circle-tile` / `.circle-launcher__new`, circles tab
 * `[data-tab="circles"]`, chat toggle `.circle-circle__view-toggle-btn`.
 */
import { expect } from '@playwright/test';

/** Boot the v2 app and open a circle chat composer. Resolves once `.circle-circle__composer-input` is visible.
 *  Lifted from the per-spec `openCircleComposer` (circle-circle-*.spec.js) so migrated specs share ONE boot. */
/**
 * Turn a circle's display name into the `buurt id` the launcher tile actually shows.
 * The wizard requires lowercase letters, digits and hyphens, and the tile renders the ID — not the name.
 */
export function circleSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Create a circle through the CREATE WIZARD.
 *
 * Circle creation used to be a `prompt()`, which is why every spec here did
 * `page.on('dialog', d => d.accept(name))`. It is now a five-step wizard — Identity · Governance · Rules ·
 * Offerings · Tech — ending in "Review →" then "Create buurt". No dialog is ever raised, so the old
 * approach could not create a circle at all: it accepted a prompt that never appeared, then clicked a tile
 * that never existed.
 *
 * Only the two REQUIRED fields are filled (Name, Buurt id); every other step is accepted as it comes, so
 * this helper keeps working when a step gains a field and fails loudly if a step gains a required one.
 */
export async function createCircleViaWizard(page, name) {
  const id = circleSlug(name);
  await page.locator('.circle-launcher__new').click();
  await page.waitForTimeout(3500);
  const inputs = page.locator('.cc-wizard-input:visible');
  await inputs.nth(0).fill(name);
  await inputs.nth(1).fill(id);
  for (let step = 0; step < 10; step += 1) {
    const advance = page.locator('.cc-wizard-btn:visible')
      .filter({ hasText: /next|review|create|maak/i });
    if (await advance.count() === 0) break;
    const label = (await advance.first().textContent() ?? '').trim();
    await advance.first().click();
    await page.waitForTimeout(1500);
    if (/create|maak/i.test(label)) break;      // the last step; the invite panel follows
  }
  await page.waitForTimeout(4000);
  // Creating leaves the INVITE panel open ("Copy URL · Copy code · Done") on top of the launcher. The tile
  // exists behind it but is not clickable, which surfaces as a click timeout on an element Playwright can
  // see — the confusing kind. Dismiss it so the caller lands back on the launcher.
  const done = page.locator('button:visible').filter({ hasText: /^(done|klaar)$/i });
  if (await done.count()) { await done.first().click(); await page.waitForTimeout(1500); }
  return id;
}

/** Boot the v2 app and open a circle chat composer for OUR circle, creating it if needed.
 *  Lifted from the per-spec `openCircleComposer` so every spec shares ONE boot. */
/**
 * Turn the per-circle TASKS feature on, through the settings surface a person would use.
 *
 * A circle created through the wizard has tasks OFF — that is the intended default, asserted by its own
 * test. So anything exercising `@assistant add X` has to enable it first, or the bot correctly answers
 * "That isn't turned on for this circle" and no task is ever created. Three specs assumed tasks-on because
 * they used to inherit whatever circle they happened to land in.
 */
export async function enableTasksFeature(page) {
  await page.locator('.circle-circle__more').click();
  await page.locator('.circle-circle__more-item[data-action="settings"]').click();
  await page.waitForTimeout(800);
  const box = page.locator('input[data-feature="tasks"]');
  await expect(box).toBeVisible({ timeout: 5000 });
  if (!(await box.isChecked())) await box.check();
  await page.locator('.circle-settings__save').click();   // the toggle alone only edits local state
  await page.waitForTimeout(800);
  const back = page.locator('.circle-settings__back');
  if (await back.count()) { await back.click(); await page.waitForTimeout(800); }
  const chat = page.locator('.circle-circle__view-toggle-btn', { hasText: 'Chat' });
  if (await chat.count()) { await chat.click(); await page.waitForTimeout(800); }
}

export async function bootCircle(page, circleName = 'Test Circle', { tasks = false } = {}) {
  const id = circleSlug(circleName);
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.locator('[data-tab="circles"]').click();
  await page.waitForTimeout(1500);

  // Open OUR circle by id — never "the first tile".
  //
  // Two product changes broke this and the suite was not run afterwards, so it went unnoticed:
  //   • help-circle provisioning (2026-07-18) means a fresh profile ALWAYS has one circle, so the old
  //     `if (no tiles) create` never fired and every spec silently ran inside Help — where the bot answers
  //     help topics and the deterministic gates do not apply;
  //   • circle creation became a wizard, so the `prompt()` these specs accepted is never raised.
  // Selecting by id is also the stronger contract: a test that names its circle cannot be quietly
  // re-pointed at a different one by anything the product adds later.
  const mine = page.locator('.circle-tile', { hasText: id });
  if (await mine.count() === 0) await createCircleViaWizard(page, circleName);
  await mine.first().click();
  await page.waitForTimeout(2500);
  await page.locator('.circle-circle__view-toggle-btn', { hasText: 'Chat' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.circle-circle__composer-input')).toBeVisible();
  if (tasks) await enableTasksFeature(page);
}

/** Send a circle composer line (explicit send button — no Enter/Escape dropdown dance). */
export async function sendCircle(page, text, settleMs = 2500) {
  await page.locator('.circle-circle__composer-input').fill(text);
  await page.locator('.circle-circle__composer-send').click();
  await page.waitForTimeout(settleMs);
}

/** All circle bubble texts (the v2 equivalent of reading #messages). */
export async function circleBubbles(page) {
  return page.locator('.circle-circle__bubble').allTextContents();
}
