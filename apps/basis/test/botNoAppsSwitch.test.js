/**
 * A household bot has no app switch: what it holds is its lists and what each list's lines are (plain, chore,
 * appointment) — the template composes the plugins that needs, and nothing names an "app" to the household. `/apps`
 * is not a command on the bot (not in its menu, its help or a screen); a person's own box keeps its app list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';
import { resolveDispatch } from '../src/router.js';
import { parseInput } from '../src/parser.js';
import { botOffers } from '../src/v2/botOpMap.js';
import { householdBotApps, HOUSEHOLD_TEMPLATE } from '../src/v2/householdTemplate.js';

describe('a household bot has no app switch', () => {
  it('/apps is not a command on the bot, not even for its admin', () => {
    const { catalogue } = composeAssistantCatalogue({ apps: householdBotApps(), slim: true });
    expect(resolveDispatch(parseInput('/apps on tasks', catalogue, {}), catalogue)?.kind).toBe('unknown');
    expect(botOffers('assistant', { id: 'assistant-apps', visibility: 'trusted' }, 'admin')).toBe(false);
    expect((catalogue.commandMenu ?? []).some((e) => /^\/apps\b/.test(e.command))).toBe(false);
  });

  it('the bot composes what its template composes: the household and the template\'s plugins, fixed', () => {
    expect(householdBotApps()).toEqual(['household', ...HOUSEHOLD_TEMPLATE.apps]);
    const runner = readFileSync(new URL('../bin/device-runner.mjs', import.meta.url), 'utf8');
    expect(runner).toMatch(/getApps: \(\) => \(isFunctionProfile \? householdBotApps\(\)/);
    expect(runner).not.toMatch(/withTemplateApps/);
  });
});
