import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';
import { openMore } from './peerHarness.js';

/**
 * The relay question, in the real app (the no-relay project: a fresh browser that knows no relay).
 *
 * There is no default relay. A device that knows none asks at the first action that needs one — making an invite,
 * which would otherwise carry no relay, so the person joining would get none either. The answer is saved through the
 * relay setting; "Later" holds for the session. The relay typed here is a closed local port: the answer is what is
 * under test, not a connection.
 */
test.setTimeout(90_000);
const LONG = 30_000;
const RELAY = 'ws://127.0.0.1:9';

async function openInviteExpectingQuestion(page) {
  expect(await openMore(page, 'invite'), 'the ⋯ menu offers an invite').toBe(true);
  const dialog = page.locator('.cc-relay-question');
  await expect(dialog, 'the relay question opens before the invite').toBeVisible({ timeout: LONG });
  return dialog;
}

async function expectInviteCode(page) {
  const code = page.locator('.cc-mydata-modal code, .cc-mydata-modal__card code');
  await code.first().waitFor({ state: 'attached', timeout: LONG });
  const link = (await code.first().innerText()).trim();
  expect(link).toMatch(/[?&]join=onderling-invite/);
  await page.mouse.click(5, 5);   // dismiss the invite
  await page.waitForTimeout(500);
  return link;
}

test('no relay known: the invite asks for one, refuses a non-relay, saves a relay through the setting, then never asks again', async ({ page }) => {
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.split('\n')[0]));
  await bootCircle(page, 'Relay Question Circle');

  const dialog = await openInviteExpectingQuestion(page);
  await dialog.locator('.cc-relay-question__input').fill('not a relay');
  await dialog.locator('.cc-relay-question__save').click();
  await expect(dialog.locator('.cc-relay-question__error')).not.toBeEmpty();
  await expect(dialog, 'a non-relay is not an answer').toBeVisible();

  await dialog.locator('.cc-relay-question__input').fill(RELAY);
  await dialog.locator('.cc-relay-question__save').click();
  await expect(dialog).toHaveCount(0, { timeout: LONG });
  expect(await expectInviteCode(page), 'the invite carries the relay to the person joining').toContain(`relay=${encodeURIComponent(RELAY)}`);
  expect(await page.evaluate(() => localStorage.getItem('cc.relayUrl')), 'saved as the relay setting').toBe(RELAY);

  // Known now: the next invite goes straight to its code.
  expect(await openMore(page, 'invite')).toBe(true);
  await expect(page.locator('.cc-relay-question')).toHaveCount(0);
  await expectInviteCode(page);
  expect(errs, `page errors: ${errs.join(' | ')}`).toEqual([]);
});

test('"Later": the invite still opens (without a relay), and the question waits for the next app start', async ({ page }) => {
  await bootCircle(page, 'Relay Later Circle');

  const dialog = await openInviteExpectingQuestion(page);
  await dialog.locator('.cc-relay-question__later').click();
  await expect(dialog).toHaveCount(0, { timeout: LONG });
  expect(await expectInviteCode(page), 'no relay to carry').not.toContain('relay=');
  expect(await page.evaluate(() => localStorage.getItem('cc.relayUrl'))).toBeFalsy();

  expect(await openMore(page, 'invite')).toBe(true);
  await expect(page.locator('.cc-relay-question'), 'not again this session').toHaveCount(0);
  await expectInviteCode(page);
});
