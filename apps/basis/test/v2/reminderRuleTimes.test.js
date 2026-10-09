// The reminder rules in a person's words carry the times the tick uses (one source: REMINDER_MOMENTS), never a time
// typed into the locale line — change the moment and the words follow.
import { describe, it, expect } from 'vitest';
import { describeRules } from '../../src/v2/reminderWords.js';
import { REMINDER_MOMENTS } from '../../src/v2/reminderOccurrences.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };
import en from '../../src/locales/circle.en.json' with { type: 'json' };

describe('the rule lines name the tick\'s own times', () => {
  it('morning and evening-before are handed REMINDER_MOMENTS; the locale lines type no time', () => {
    const seen = [];
    const tp = (k, v) => { seen.push([k, v]); return k; };
    describeRules(['morning', 'evening-before'], tp);
    expect(seen).toEqual([
      ['circle.bot.rule_morning', { time: REMINDER_MOMENTS.morning }],
      ['circle.bot.rule_evening', { time: REMINDER_MOMENTS.evening }],
    ]);
    for (const b of [nl, en]) {
      for (const k of ['rule_morning', 'rule_evening']) {
        const text = b.bot[k].text ?? b.bot[k];
        expect(text, k).not.toMatch(/\d\d:\d\d/);
        expect(text, k).toContain('{{time}}');
      }
    }
  });
});
