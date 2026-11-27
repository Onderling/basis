/**
 * THE BROWSER LOCK — on a real browser (the person's own code in front of the key door).
 *
 * The unit tests pin the boot step and the door (keyDoorBoot.test.js, the vault's door tests). What only a browser
 * shows: that the switch in Instellingen → Herstel really locks the door, that a reload paints the lock screen BEFORE
 * the agent exists, that a wrong code stays locked, that the right code opens the SAME person, that "lock now" locks,
 * and that a forgotten code has a way out: the start-over page, from a LOCKED door, back to the same person by phrase.
 * The derivation takes about a second per try, so the timeouts are generous.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/app-lock.spec.js
 */
import { test, expect } from '@playwright/test';

test.setTimeout(240_000);

const CODE = 'zeven blauwe stoelen';
const call = (page, app, op, args = {}) => page.evaluate(([a, o, g]) => window.onderlingCall(a, o, g), [app, op, args]);
const ready = (page) => page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 90_000 });
// a probe that names its branch: `{webid}` or `{none: <what the call said>}`
const whoAmI = async (page, timeout = 60_000) => {
  const t0 = Date.now(); let last = null;
  for (;;) {
    try { last = await call(page, 'pinboard', 'whoAmI', {}); if (last?.webid) return { webid: last.webid }; } catch (e) { last = String(e?.message ?? e); }
    if (Date.now() - t0 > timeout) return { none: JSON.stringify(last)?.slice(0, 200) };
    await new Promise((r) => { setTimeout(r, 1000); });
  }
};
const phraseOf = async (page, timeout = 90_000) => {
  const t0 = Date.now(); let last = null;
  for (;;) {
    try { last = await call(page, 'household', 'revealOwnerPhrase', {}); if (last?.mnemonic) return { phrase: last.mnemonic }; } catch (e) { last = String(e?.message ?? e); }
    if (Date.now() - t0 > timeout) return { none: JSON.stringify(last)?.slice(0, 200) };
    await new Promise((r) => { setTimeout(r, 1000); });
  }
};
const openLockSection = async (page) => {
  await page.locator('.cc-persona-button__settings').click();
  await page.locator('.cc-settings__group--recovery').click();
  await expect(page.locator('[data-section="app-lock"]').first(), 'the lock section is in Herstel').toBeVisible({ timeout: 15_000 });
};
const lockScreen = (page) => page.locator('[data-testid="lock-screen"]');

test('the lock: switch on, reload asks, a wrong code stays locked, the right one opens the same person; lock now; forgot leads to the phrase', async ({ page, context }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await page.goto('/');
  await expect(page.locator('.cc-persona-button__button')).toBeVisible({ timeout: 30_000 });
  await ready(page);
  const who = await whoAmI(page);
  expect(who.webid, `who this is (${who.none ?? ''})`).toBeTruthy();
  const { phrase, none } = await phraseOf(page);
  expect(phrase, `the phrase can be read (${none ?? ''})`).toBeTruthy();

  // a SECOND TAB of the same browser, open before the lock: the lock is for someone else at this computer, and a tab
  // left open must not be their way in
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.locator('.cc-persona-button__button')).toBeVisible({ timeout: 60_000 });

  // 1 · SWITCH ON: the code twice; a mismatch is said and nothing is set. The browser is not asked to save it.
  await openLockSection(page);
  const sw = page.locator('[data-testid="app-lock-switch"]');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  for (const id of ['app-lock-field', 'app-lock-again']) await expect(page.locator(`[data-testid="${id}"]`), `${id}: no password saving`).toHaveAttribute('autocomplete', 'off');
  await page.locator('[data-testid="app-lock-field"]').fill(CODE);
  await page.locator('[data-testid="app-lock-again"]').fill(`${CODE}x`);
  await page.locator('[data-testid="app-lock-go"]').click();
  await expect(page.locator('[data-testid="app-lock-said"]')).not.toBeEmpty();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-testid="app-lock-again"]').fill(CODE);
  await page.locator('[data-testid="app-lock-go"]').click();
  await expect(page.locator('[data-testid="app-lock-switch"]'), 'the section repaints with the lock on').toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await expect(page.locator('[data-testid="app-lock-now"]')).toBeVisible();
  await expect(lockScreen(other), 'the other tab is told and reloads onto the lock screen').toBeVisible({ timeout: 30_000 });

  // 2 · RELOAD: the lock screen, before the agent exists
  await page.reload();
  await expect(lockScreen(page)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-testid="lock-field"]'), 'no password saving').toHaveAttribute('autocomplete', 'off');
  await expect(lockScreen(page), 'the lock screen speaks words, not locale keys').not.toContainText('circle.lock.');
  // `onderlingCall` is installed at the module's load and answers `callSkill-not-ready` until the boot: behind the
  // lock the waist names nobody
  const behind = await call(page, 'pinboard', 'whoAmI', {}).catch((e) => ({ error: String(e?.message ?? e) }));
  expect(behind?.webid, `nothing of the person is up behind the lock (${JSON.stringify(behind)?.slice(0, 120)})`).toBeFalsy();

  // 3 · A WRONG CODE stays locked and says so
  await page.locator('[data-testid="lock-field"]').fill('niet de code');
  await page.locator('[data-testid="lock-open"]').click();
  await expect(page.locator('[data-testid="lock-said"]')).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('[data-testid="lock-open"]'), 'asked again').toBeEnabled({ timeout: 30_000 });
  await expect(lockScreen(page)).toBeVisible();

  // 4 · THE RIGHT CODE opens the same person
  await page.locator('[data-testid="lock-field"]').fill(CODE);
  await page.locator('[data-testid="lock-open"]').click();
  await expect(lockScreen(page)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('.cc-persona-button__button')).toBeVisible({ timeout: 60_000 });
  expect(await whoAmI(page), 'the same person behind the lock').toEqual({ webid: who.webid });
  // the other tab opens with the code too
  await other.locator('[data-testid="lock-field"]').fill(CODE);
  await other.locator('[data-testid="lock-open"]').click();
  await expect(other.locator('.cc-persona-button__button')).toBeVisible({ timeout: 60_000 });

  // 5 · SWITCH OFF WITH A WRONG CODE: checked on a second door object, says so, the lock stays on and this tab's
  // door stays open (lock now below still works). Then LOCK NOW: back to the lock screen
  await openLockSection(page);
  await page.locator('[data-testid="app-lock-switch"]').click();
  await expect(page.locator('[data-testid="app-lock-again"]'), 'off asks the code once').toHaveCount(0);
  await page.locator('[data-testid="app-lock-field"]').fill('niet de code');
  await page.locator('[data-testid="app-lock-go"]').click();
  await expect(page.locator('[data-testid="app-lock-said"]')).not.toBeEmpty({ timeout: 30_000 });
  await expect(page.locator('[data-testid="app-lock-go"]')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[data-testid="app-lock-switch"]')).toHaveAttribute('aria-checked', 'true');
  expect(await whoAmI(page), 'this tab is still open after a wrong code').toEqual({ webid: who.webid });
  // SWITCH OFF WITH THE RIGHT CODE: the other tab still holds the locked shape's door key, so it is told and reloads
  // (a mark set in it is gone after a reload) into an open door
  await other.evaluate(() => { window.__beforeOff = true; });
  await page.locator('[data-testid="app-lock-field"]').fill(CODE);
  await page.locator('[data-testid="app-lock-go"]').click();
  await expect(page.locator('[data-testid="app-lock-switch"]'), 'the lock is off').toHaveAttribute('aria-checked', 'false', { timeout: 30_000 });
  await other.waitForFunction(() => !window.__beforeOff, null, { timeout: 30_000 });
  await expect(other.locator('.cc-persona-button__button'), 'the other tab opens with no code').toBeVisible({ timeout: 60_000 });
  await expect(lockScreen(other)).toHaveCount(0);
  // and on again, for lock now below (the other tab is locked again and opened with the code)
  await page.locator('[data-testid="app-lock-switch"]').click();
  await page.locator('[data-testid="app-lock-field"]').fill(CODE);
  await page.locator('[data-testid="app-lock-again"]').fill(CODE);
  await page.locator('[data-testid="app-lock-go"]').click();
  await expect(page.locator('[data-testid="app-lock-switch"]')).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await expect(lockScreen(other)).toBeVisible({ timeout: 30_000 });
  await other.locator('[data-testid="lock-field"]').fill(CODE);
  await other.locator('[data-testid="lock-open"]').click();
  await expect(other.locator('.cc-persona-button__button')).toBeVisible({ timeout: 60_000 });
  await page.locator('[data-testid="app-lock-now"]').click();
  await expect(lockScreen(page), 'lock now reloads onto the lock screen').toBeVisible({ timeout: 30_000 });
  await expect(lockScreen(other), 'lock now locks the other tab too').toBeVisible({ timeout: 30_000 });
  // the start-over below deletes the databases, which an open tab would block
  await other.close();

  // 6 · FORGOT: the start-over page, from a LOCKED door, and the phrase brings back the same person
  await page.locator('[data-testid="lock-forgot"]').click();
  await expect(page.locator('[data-testid="start-over"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('.start-over__phrase').fill(phrase);
  await page.locator('[data-testid="start-over-check"]').click();
  await page.locator('[data-testid="start-over-yes"]').click({ timeout: 30_000 });
  // which branch: a reload (the start-over finished) or a line saying why it stopped
  const outcome = await Promise.race([
    page.waitForEvent('framenavigated', { timeout: 90_000 }).then(() => 'reloaded'),
    page.waitForFunction(() => { const s = document.querySelector('.start-over__said')?.textContent ?? ''; return s && !/…$|\.working$/.test(s) ? s : null; }, null, { timeout: 90_000 }).then((h) => h.jsonValue()).then((s) => `said: ${s}`),
  ]);
  expect(outcome, 'the start-over finished and reloaded').toBe('reloaded');
  // a fresh start opens on the welcome and "finishing your restore", not on the lock screen
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 60_000 });
  await expect(lockScreen(page), 'a fresh start has no lock').toHaveCount(0);
  expect(await whoAmI(page), 'the same person after the start-over').toEqual({ webid: who.webid });
  expect(errs).toEqual([]);
});
