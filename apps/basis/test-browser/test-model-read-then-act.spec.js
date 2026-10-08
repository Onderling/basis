import { test, expect } from '@playwright/test';
import { bootCircle, sendCircle } from './helpers.js';

// A stand-in model behind the real model interface (src/v2/testModel.js; development builds only): the circle bot's
// whole model route runs — the prompt, the tools, reading the answer, the read-then-act look — with a script
// instead of a key. "kun je de melkproef afronden": the model first picks a READ (the open tasks); the look hands it back; the model
// then picks the ACT. No list is shown in between, and the act is done.
test.setTimeout(120000);

const SCRIPT = [
  { when: 'kun je de melkproef afronden', toolCall: { id: 'listOpen', args: {} } },
  { when: 'kun je de melkproef afronden', toolCall: { id: 'completeTask', args: { id: 'melkproef' } } },
];

test('the read-then-act look on web, through the real model route', async ({ page }) => {
  await page.addInitScript((script) => { window.__onderlingTestModel = { script }; }, SCRIPT);
  await bootCircle(page, 'Model Kring', { tasks: true });
  // the circle allows a model (a new circle forbids one; the alpha settings do not show the switch)
  await page.evaluate(async () => {
    const ids = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('cc.circlePolicy.')) ids.push(k.slice('cc.circlePolicy.'.length));
    }
    for (const id of ids) await window.onderlingCirclePolicy.update(id, { llmTool: 'user' });
  });
  await sendCircle(page, '@assistant add melkproef');
  const before = await page.locator('.circle-view__bubble').count();
  await sendCircle(page, '@assistant kun je de melkproef afronden', 4000);
  const asked = await page.evaluate(() => window.__onderlingTestModel.requests);
  const said = (await page.locator('.circle-view__bubble').allTextContents()).slice(before).join(' | ');
  expect(asked.length, said).toBe(2);
  // the second request carries what the read found (the look's line), and the tools the circle offers
  expect(JSON.stringify(asked[1])).toContain('melkproef');
  expect(asked[0].tools).toContain('completeTask');
  expect(said).toMatch(/Completed:\s*melkproef/i);
});
