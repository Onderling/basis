/**
 * THE CREATE WIZARD: A PRESET IS A STARTING POINT. A household pre-fills every policy axis; the person changes the LLM
 * tool, the agents, the consensus and a feature on the wizard's own screens, and the circle that comes out has THEIR
 * choices in its policy — not the preset's.
 *
 *   PEER_TEST_PORT=5273 npx playwright test --project=no-relay test-browser/create-every-axis.spec.js
 */
import { test, expect } from '@playwright/test';
import { fillFounderHandle } from './helpers.js';

test.setTimeout(180_000);

const call = (page, app, op, args = {}) => page.evaluate(({ app, op, args }) => window.onderlingCall(app, op, args), { app, op, args });
const NAME = 'Huize Elke-As';
/** the circle the wizard made, by its name — the app makes circles of its own at boot (the help circle, a pair) */
const madeCircle = async (page) => {
  const r = await call(page, 'pinboard', 'listMyCircles', {});
  return (r?.circles ?? []).find((id) => r?.names?.[id] === NAME) ?? null;
};
const fieldset = (page, legend) => page.locator('fieldset:visible').filter({ has: page.locator('legend', { hasText: legend }) });

test("every axis the person changes is the policy the circle gets", async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.onderlingCall === 'function', null, { timeout: 60_000 });
  await page.locator('[data-tab="circles"]').first().click();
  await page.locator('.circle-launcher__new').click();
  await page.locator('.cc-wizard-input:visible').first().waitFor({ timeout: 15_000 });
  await page.locator('.cc-wizard-input:visible').nth(0).fill(NAME);
  await fillFounderHandle(page, 'anna');
  const household = page.locator('input[type="radio"][value="household"]:visible');
  if (await household.count()) await household.first().check({ force: true });
  await page.locator('details[data-role="advanced"] > summary').first().click();
  await page.waitForTimeout(400);

  let changed = false;
  for (let step = 0; step < 12; step += 1) {
    const llm = fieldset(page, /LLM/);
    if (!changed && await llm.count()) {
      await llm.locator('input[value="off"]').check({ force: true });
      await fieldset(page, /Agents/).locator('input[value="no"]').check({ force: true });
      const cons = page.locator('label.cc-wizard-toggle', { hasText: /co-admin|beheerders/i }).locator('input');
      if (!(await cons.isChecked())) await cons.check({ force: true });
      const tasks = page.locator('label.cc-wizard-toggle[data-feature="tasks"] input');
      if (await tasks.isChecked()) await tasks.uncheck({ force: true });
      changed = true;
      await page.waitForTimeout(400);
    }
    const advance = page.locator('.cc-wizard-btn:visible').filter({ hasText: /next|review|create|volgende|overzicht|controle|maken/i });
    if (await advance.count() === 0) break;
    const label = (await advance.first().textContent() ?? '').trim();
    await advance.first().click();
    await page.waitForTimeout(1000);
    if (/create|maken/i.test(label)) break;
  }
  expect(changed, 'the wizard never showed the LLM-tool, agents, consensus and feature controls').toBe(true);

  const done = page.locator('button:visible').filter({ hasText: /^(done|klaar)$/i });
  await done.first().waitFor({ timeout: 30_000 }).catch(() => {});
  if (await done.count()) await done.first().click();
  const made = await expect.poll(async () => (await madeCircle(page)) ?? null,
    { timeout: 30_000, intervals: [1000], message: 'the wizard made no circle by that name' }).not.toBeNull().then(() => madeCircle(page));
  const id = made;
  const policy = await page.evaluate((cid) => window.onderlingCirclePolicy.get(cid), id);
  // a household's preset says local / admin-approval / no consensus / tasks on — the person said otherwise
  expect(policy?.llmTool, JSON.stringify(policy)).toBe('off');
  expect(policy?.agents).toBe('no');
  expect(policy?.governance?.changePolicy).toBe('admin-quorum');
  expect(policy?.features?.tasks).toBe(false);
});
