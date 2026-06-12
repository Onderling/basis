import { test, expect } from '@playwright/test';

// Form-elicitation parity — when a kring command needs a missing field (needsForm with one missing
// param), the bot asks for it IN THE KRING and the user's NEXT message answers (shared src/v2/followUp.js,
// the chat-native conversational path, web + mobile). Here a bare typed slash `/addtask` (dispatched
// verbatim by the bot — createCircleDispatch step 1, no LLM) has a required `text` with no value ⇒
// needsForm ⇒ the bot prompts ⇒ the next message fills it ⇒ the task is created.
test.setTimeout(70000);

async function openKringComposer(page) {
  page.on('dialog', (d) => d.accept('P5 Circle'));
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.locator('[data-tab="kringen"]').click();
  await page.waitForTimeout(1500);
  if (await page.locator('.circle-tile').count() === 0) {
    await page.locator('.circle-launcher__new').click();
    await page.waitForTimeout(5000);
  }
  await page.locator('.circle-tile').first().click();
  await page.waitForTimeout(2500);
  await page.locator('.circle-kring__view-toggle-btn', { hasText: 'Chat' }).click();
  await page.waitForTimeout(1200);
  await expect(page.locator('.circle-kring__composer-input')).toBeVisible();
}

async function send(page, text) {
  await page.locator('.circle-kring__composer-input').fill(text);
  await page.locator('.circle-kring__composer-send').click();
  await page.waitForTimeout(2500);
}

test('needsForm → conversational follow-up: bot asks for the missing field, the next message answers + dispatches', async ({ page }) => {
  await openKringComposer(page);

  // A bare typed slash `/addtask` is dispatched verbatim by the bot; `text` (required) is empty ⇒ needsForm.
  await send(page, '/addtask');
  const afterAsk = (await page.locator('.circle-kring__bubble').allTextContents()).join(' | ');
  // The bot asked for the missing field (generic followup prompt: "What's your text? (for /addTask)").
  expect(afterAsk, `bot should have asked for the missing field, got: ${afterAsk}`).toMatch(/what's your|wat is je/i);
  // …and it must NOT have just errored or dispatched blindly.
  expect(afterAsk).not.toMatch(/item not found|unknown command/i);

  // The user's NEXT message is the answer — it completes the pending dispatch (not a new command).
  await send(page, 'p5followmilk');
  const afterAnswer = (await page.locator('.circle-kring__bubble').allTextContents()).join(' | ');
  expect(afterAnswer, `the answer should have created the task, got: ${afterAnswer}`).toMatch(/p5followmilk/);
});
