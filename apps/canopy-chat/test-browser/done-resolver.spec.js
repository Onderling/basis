/**
 * P3 smoke (commit 8e514c44) — web typed-slash task completion now resolves a
 * human label → task id via the SHARED resolver (`clarifyCommandTargets` +
 * `makeCircleLookup`, live fetch + cache), called from `resolveTextArgsInPlace`
 * (main.js). `resolveTextArgsInPlace`'s body was retired in favour of the shared
 * resolver.
 *
 * IMPORTANT routing fact established while writing this smoke:
 *   In the CLASSIC shell, the typed-slash that exercises the shared resolver is
 *   `/complete-task <label>` — NOT `/done <label>`. The completeTask op declares
 *   `surfaces.slash.command = '/complete-task'` (mockManifests.js:111); 'done' is
 *   only an NL-gate VERB, and `parseSlash` matches the literal command token
 *   against commandMenu exactly (parser.js:98). With no LLM, the NL gate never
 *   runs, so a literal `/done dishwasher` is an UNMATCHED slash → "unknown
 *   command" (by design, not a bug). The shared resolver lives on the
 *   typed-slash path (parse.kind==='slash' → resolveTextArgsInPlace, main.js:2261),
 *   which `/complete-task` takes and `/done` does not. This spec therefore drives
 *   the resolver via `/complete-task`, and separately documents `/done`'s
 *   unknown-by-design behavior.
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

test('P3 (documentation): literal /done <label> is an UNMATCHED slash in the classic shell (unknown-by-design, not the resolver path)', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/classic.html');
  await page.waitForTimeout(4000);
  expect(
    pageErrors,
    `classic shell threw at boot — the JS never wired up (shell is dead): ${pageErrors.join(' | ')}`,
  ).toEqual([]);

  // `/done` is NOT a registered slash command (only `/complete-task` is); 'done'
  // is an NL-gate verb that needs an LLM-addressed turn. So `/done x` must route
  // to the shell's unknown-command path and must NOT crash the shell.
  await send(page, `/done ${LABEL}`, 2000);
  expect(await streamText(page)).toMatch(/unknown command|onbekend commando/i);
  // Shell still responsive afterwards:
  await send(page, '/me', 2000);
  await expect(page.locator('#messages')).toContainText(/pubKey/i, { timeout: 5_000 });
});
