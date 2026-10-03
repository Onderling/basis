/**
 * FITNESS: where a household bot's things live is declared once (`HOUSEHOLD_BOT_STORE_OPTS`) and spread by the box and
 * by every test that composes the bot. A test that spells `calendarInCircle` / `tasksInCircle` itself can boot a bot
 * whose chores live where the box's do not (a harness that measures itself).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));

describe('FITNESS: the bot\'s store options are declared once', () => {
  it('the box spreads them', () => {
    expect(readFileSync(path.join(root, 'bin/device-runner.mjs'), 'utf8')).toMatch(/\.\.\.HOUSEHOLD_BOT_STORE_OPTS/);
  });
  it('no test spells them itself', () => {
    const spelled = walk(path.join(root, 'test')).filter((f) => f.endsWith('.js') && !f.endsWith('botStoreOptsOnce.test.js'))
      .filter((f) => /\b(calendarInCircle|tasksInCircle)\s*:/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(root, f));
    expect(spelled).toEqual([]);
  });
});
