import { test, expect } from '@playwright/test';
import { bootCircle } from './helpers.js';

// The agent's own lines follow the person's language: web hands the agent its translator. Before, a task's
// confirmation from the agent was its English fallback ("✓ Claimed: …") whatever the language. (The circle view paints
// its own confirmation over it, so the agent is asked directly here.)
test.setTimeout(90000);
test.use({ locale: 'nl-NL' });

test('a Dutch browser gets the agent\'s task lines in Dutch', async ({ page }) => {
  await bootCircle(page, 'NL Kring', { tasks: true });
  const send = async (text) => {
    await page.locator('.circle-view__composer-input').fill(text);
    await page.locator('.circle-view__composer-send').click();
    await page.waitForTimeout(2500);
  };
  // the agent as web composed it, asked directly: its own confirmation, in the person's language
  const r = await page.evaluate(async () => {
    const added = await window.onderlingCall('tasks', 'addTask', { text: 'melkproef' });
    const id = added?.itemId ?? added?.task?.id;
    return id ? window.onderlingCall('tasks', 'claimTask', { id }) : { error: 'no id', added };
  });
  expect(r?.message, JSON.stringify(r)).toMatch(/Opgepakt:\s*melkproef/);
});
