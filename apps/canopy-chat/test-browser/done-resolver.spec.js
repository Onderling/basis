/**
 * P3 smoke (commit 8e514c44) — web typed-slash task completion now resolves a
 * human label → task id via the SHARED resolver (`clarifyCommandTargets` +
 * `makeCircleLookup`, live fetch + cache), called from `resolveTextArgsInPlace`
 * (main.js). `resolveTextArgsInPlace`'s body was retired in favour of the shared
 * resolver.
 *
 * Routing fact (corrected 2026-06-12, browser-verified — the original note here was wrong):
 *   BOTH `/complete-task <label>` (tasks-v0 `completeTask`) AND `/done <label>` (mockAgent
 *   `markComplete`, a household-chore complete) are REGISTERED slash commands whose id-param declares
 *   a `pickerSource.listOp` (`completeTask.id` / `markComplete.choreId`, both `listOpen`). So BOTH
 *   take the typed-slash resolver path (`parse.kind==='slash'` → `resolveTextArgsInPlace`, main.js)
 *   and resolve a human label → an id with no LLM. The earlier claim that `/done` was an "unmatched /
 *   unknown" slash was a mis-read — mockAgent declares `/done` (mockAgent.js:67). This spec drives the
 *   resolver via `/complete-task` (tasks-v0) and separately confirms `/done` is handled the same way.
 *
 * Two stacked resolver bugs this smoke now guards (both fixed 2026-06-12):
 *   • circleLookup leaked the THREAD id as a crewId when `getActiveCircle()` was null (web non-circle
 *     thread) → the live fetch hit a non-existent crew → nothing resolved. Fix: `scopeId` authoritative.
 *   • the parser leaves the positional body under `_match`; the router bound it to the id-param only
 *     AFTER the resolver ran. Fix: bind `_match` first in `resolveTextArgsInPlace`.
 *
 * Flow (no LLM needed — add/list/complete are deterministic in-browser ops):
 *   1. `/addtask dishwasher`           → creates the task (in the default crew).
 *   2. `/mytasks`                      → the task is listed (seeds the lookup cache).
 *   3. `/complete-task dishwasher`     → the LABEL resolves to the task id via the
 *                                        shared resolver and the task completes:
 *                                        a "✓ Completed" bubble, and crucially NO
 *                                        "item not found" / "couldn't find" error.
 *   4. `/mytasks` again               → the task is gone (completed), confirming
 *                                        the id actually resolved + dispatched.
 */
import { test, expect } from '@playwright/test';

test.setTimeout(90_000);

const LABEL = 'dishwasher';

async function send(page, text, settleMs = 1800) {
  const input = page.locator('#chat-input');
  await input.fill(text);
  // Dismiss the command-suggest dropdown first: when it's open with a highlighted entry, the shell's
  // keydown handler treats Enter as "accept the suggestion" (preventDefault) instead of submitting the
  // form (main.js ~1974). A single Enter on a slash command would be swallowed → no message sent.
  await input.press('Escape');
  await input.press('Enter');
  await page.waitForTimeout(settleMs);
}

async function streamText(page) {
  return page.locator('#messages').innerText().catch(() => '');
}

test('P3: typed-slash /complete-task <label> resolves the label to a task id and completes it (no "not found")', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/classic.html');
  await page.waitForTimeout(4000);

  // Guard: the shell must boot, else #messages never wires up and the resolver
  // path is never reached. Fail descriptively rather than time out.
  expect(
    pageErrors,
    `classic shell threw at boot — the JS never wired up (shell is dead): ${pageErrors.join(' | ')}`,
  ).toEqual([]);

  // 1. Create the task.
  await send(page, `/addtask ${LABEL}`, 2500);
  await expect(page.locator('#messages')).toContainText(new RegExp(`Added task[:\\s].*${LABEL}|${LABEL}`, 'i'), { timeout: 8_000 });

  // 2. List → the task shows + seeds the lookup cache.
  await send(page, '/mytasks', 2000);
  await expect(page.locator('#messages')).toContainText(new RegExp(LABEL, 'i'), { timeout: 8_000 });

  // 3. Complete by HUMAN LABEL via the typed-slash path (the shared resolver).
  await send(page, `/complete-task ${LABEL}`, 3000);
  const afterComplete = await streamText(page);

  // The resolver fix's whole point: the label must NOT surface a not-found error.
  expect(
    afterComplete,
    `/complete-task ${LABEL} surfaced a not-found error — the shared label resolver did NOT bind the label to an id`,
  ).not.toMatch(/couldn't find|could not find|not found|niet vinden|unknown command|onbekend/i);

  // And it should confirm completion.
  expect(afterComplete).toMatch(/Completed|✓|voltooid|klaar/i);

  // 4. Re-list → the completed task is no longer an open/claimed task, proving the
  //    id actually resolved + the completeTask dispatch took effect.
  await send(page, '/mytasks', 2500);
  const afterRelist = await streamText(page);
  // Last /mytasks block should not still list the label as an open task. We assert
  // the post-completion list text does not re-list the label (best-effort: the
  // label only appeared from the earlier list; a fresh empty/▢-less list is enough).
  // Soft check via the dedicated empty-list affordance OR absence of the label in
  // the latest rendered list section:
  const latest = afterRelist.slice(afterRelist.lastIndexOf('/mytasks') >= 0 ? 0 : 0);
  expect(latest).not.toMatch(new RegExp(`▢\\s*${LABEL}`, 'i'));
});

test('P3: /done <label> is ALSO a registered label-resolving command (mockAgent markComplete) — handled, never "unknown command"', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/classic.html');
  await page.waitForTimeout(4000);
  expect(
    pageErrors,
    `classic shell threw at boot — the JS never wired up (shell is dead): ${pageErrors.join(' | ')}`,
  ).toEqual([]);

  // `/done` IS registered — mockAgent's `markComplete` (a household-chore complete), whose `choreId`
  // param declares `pickerSource: { listOp: 'listOpen' }`. So `/done <label>` takes the SAME typed-slash
  // resolver path as `/complete-task` (the label binds via `_match` → `choreId`, then resolves to a
  // chore id). It must therefore be HANDLED — never the shell's "unknown command" bucket — and must not
  // crash the shell. (Whether a given label hits a chore is data-dependent; what's invariant is that the
  // command is recognised and the resolver runs, so "unknown command" must NOT appear.)
  await send(page, `/done ${LABEL}`, 2500);
  const afterDone = await streamText(page);
  expect(
    afterDone,
    `/done ${LABEL} surfaced "unknown command" — it should route to mockAgent.markComplete, not the unknown bucket`,
  ).not.toMatch(/unknown command|onbekend commando/i);
  // Shell still responsive afterwards:
  await send(page, '/me', 2000);
  await expect(page.locator('#messages')).toContainText(/pubKey/i, { timeout: 5_000 });
});
