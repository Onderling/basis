/**
 * FITNESS: every question the household bot asks before an act is in the person's words — a `messageKey` with a
 * Dutch and an English entry, never only the manifest's English fallback ("Cancel this event?" on a Dutch bot, found
 * on a walk 2026-10-01). Read over the bot's own catalogue, as the box composes it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { composeAssistantCatalogue } from '../../src/telegram/assistantCatalogue.js';
import { HOUSEHOLD_TEMPLATE } from '../../src/v2/householdTemplate.js';

const NL = JSON.parse(readFileSync(new URL('../../src/locales/circle.nl.json', import.meta.url), 'utf8'));
const EN = JSON.parse(readFileSync(new URL('../../src/locales/circle.en.json', import.meta.url), 'utf8'));
const has = (bundle, key) => {
  const v = key.replace(/^circle\./, '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), bundle);
  return typeof v === 'string' || typeof v?.text === 'string';
};

describe('FITNESS: the bot asks in the person\'s words', () => {
  it('every confirm on the bot\'s door has a messageKey in both languages', () => {
    const { catalogue } = composeAssistantCatalogue({ apps: [...HOUSEHOLD_TEMPLATE.apps], slim: true });
    const missing = [];
    for (const [, entry] of catalogue.opsById) {
      const c = entry?.op?.surfaces?.ui?.confirm;
      if (!c) continue;
      if (!c.messageKey || !has(NL, c.messageKey) || !has(EN, c.messageKey)) missing.push(`${entry.appOrigin}:${entry.op.id}`);
    }
    expect(missing).toEqual([]);
  });
});
