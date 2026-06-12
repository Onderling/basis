/**
 * P1 smoke (commit 12d27b14) — web adopted the shared `createFeedbackMount`.
 *
 * Verifies, on the CLASSIC shell (/classic.html → main.js), that the feedback
 * routing mount works end-to-end WITHOUT an LLM (the control intents — /help,
 * /klaar, /feedback-stop — are deterministic, no model needed):
 *
 *   1. `/feedback`            → enters feedback mode; the bot posts its guidance
 *                              (the first bot bubble = the bot's /help text).
 *   2. free text while active → routed to the feedback bot (NOT the normal shell
 *                              "unknown command" path); the bot acknowledges.
 *   3. `/help` (a bot slash)  → reaches the bot (its guidance text re-appears),
 *                              proving the bot's OWN slash commands are forwarded.
 *   4. `/klaar` (review)      → reaches the bot (review step runs; with an empty/
 *                              no-LLM session the bot replies, e.g. "no points yet").
 *   5. `/feedback-stop`       → exits feedback mode; a subsequent normal slash
 *                              (`/me`) is handled by the SHELL, not the bot.
 *
 * NOTE: the feedback bot runs fully in-browser (InternalBus + co-hosted
 * CanopyChatBot); the bot defaults to Dutch (exampleProjectConfig nl). Assertions
 * key on behavior (a NEW bot bubble appears / mode toggles) plus stable Dutch
 * substrings, so they don't depend on an LLM being reachable.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const HELP_SUBSTR = 'Zo werkt het';  // start of the feedback bot's /help guidance (nl.js)

async function send(page, text, settleMs = 1500) {
  const input = page.locator('#chat-input');
  await input.fill(text);
  // Dismiss the command-suggest dropdown first: when it's open with a highlighted entry, the shell's
  // keydown handler treats Enter as "accept the suggestion" (preventDefault) instead of submitting the
  // form (main.js ~1974). A single Enter on a slash command would be swallowed → no message sent.
  await input.press('Escape');
  await input.press('Enter');
  await page.waitForTimeout(settleMs);
}

/** innerText of the message stream (empty string if not present). */
async function streamText(page) {
  return page.locator('#messages').innerText().catch(() => '');
}

/** Count rendered message rows (any direct-child bubble) in #messages. */
async function bubbleCount(page) {
  return page.locator('#messages > *').count().catch(() => 0);
}

test('P1: /feedback enters mode, bot posts guidance, free text + bot-slash reach the bot, /feedback-stop exits', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/classic.html');
  await page.waitForTimeout(4000);

  // Guard: the shell must actually boot. If main.js aborts during module
  // evaluation (e.g. a Node-only `process` reference in an eagerly-imported
  // module), #messages never wires up and every assertion below is vacuous.
  // Surface that as an explicit, descriptive failure instead of a timeout.
  expect(
    pageErrors,
    `classic shell threw at boot — the JS never wired up (shell is dead): ${pageErrors.join(' | ')}`,
  ).toEqual([]);

  // 1. /feedback → enter mode; the bot's /help guidance is the first bubble.
  await send(page, '/feedback', 3500);
  await expect(page.locator('#messages')).toContainText(HELP_SUBSTR, { timeout: 10_000 });
  const afterEnter = await bubbleCount(page);
  expect(afterEnter, 'a bot guidance bubble should appear after /feedback').toBeGreaterThan(0);

  // 2. free text while active → goes to the feedback bot, not the shell's
  //    "unknown command". A new bubble (the bot's reply) should appear, and the
  //    stream must NOT contain the shell's unknown-command marker for this text.
  const beforeFree = await bubbleCount(page);
  await send(page, 'het plein is te druk', 2500);
  const afterFree = await bubbleCount(page);
  expect(afterFree, 'free text while active should add at least the user bubble + a bot reply').toBeGreaterThan(beforeFree);
  expect(await streamText(page)).not.toMatch(/unknown command|onbekend commando/i);

  // 3. /help (the bot's OWN slash) reaches the bot → its guidance re-appears.
  const beforeHelp = await bubbleCount(page);
  await send(page, '/help', 2500);
  const afterHelp = await bubbleCount(page);
  expect(afterHelp, '/help should be forwarded to the bot (new bubbles)').toBeGreaterThan(beforeHelp);
  // The bot's help text appears again (so /help routed to the bot, not the shell).
  const helpOccurrences = (await streamText(page)).split(HELP_SUBSTR).length - 1;
  expect(helpOccurrences, '/help should re-emit the bot guidance').toBeGreaterThanOrEqual(2);

  // 4. /klaar (review/submit step) reaches the bot. With no points / no LLM the
  //    bot still replies (e.g. "no points yet") — the point is it ROUTED to the
  //    bot, not the shell. Assert: a new bubble + NO shell unknown-command error.
  const beforeKlaar = await bubbleCount(page);
  await send(page, '/klaar', 3500);
  const afterKlaar = await bubbleCount(page);
  expect(afterKlaar, '/klaar should reach the bot (review reply bubble)').toBeGreaterThan(beforeKlaar);
  expect(await streamText(page)).not.toMatch(/unknown command|onbekend commando/i);

  // 5. /feedback-stop → exits. The shell shows its localised confirmation, and a
  //    subsequent normal slash (/me) is handled by the SHELL (identity bubble),
  //    proving we're no longer routing free text/slashes to the bot.
  await send(page, '/feedback-stop', 1500);
  await send(page, '/me', 2000);
  await expect(page.locator('#messages')).toContainText(/pubKey/i, { timeout: 5_000 });
});
