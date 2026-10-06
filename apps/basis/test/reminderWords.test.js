/**
 * How a person says their reminders, in either language: "60" is an hour before, "ochtend"/"morning" the morning,
 * "avond"/"evening" the evening before, "7:30" at that time; "ook"/"also" ADDS to what applies, otherwise it REPLACES;
 * "geen"/"none" is none at all. One word it does not know, and nothing is set.
 */
import { describe, it, expect } from 'vitest';
import { reminderLayerFromWords, reminderRulesFrom, withLead, leadOf, HOUSEHOLD_RULES_DEFAULT } from '../src/v2/reminderWords.js';

describe('reminder words', () => {
  it('replace by default, add with "ook"/"also"', () => {
    expect(reminderLayerFromWords('60')).toEqual({ mode: 'replace', rules: ['before:60'] });
    expect(reminderLayerFromWords('ook avond')).toEqual({ mode: 'add', rules: ['evening-before'] });
    expect(reminderLayerFromWords('also morning 15')).toEqual({ mode: 'add', rules: ['morning', 'before:15'] });
    expect(reminderLayerFromWords('ochtend 7:30')).toEqual({ mode: 'replace', rules: ['morning', 'at:07:30'] });
    expect(reminderLayerFromWords('before:60, evening-before')).toEqual({ mode: 'replace', rules: ['before:60', 'evening-before'] });
  });

  it('"geen"/"none" is none; an unknown word or nothing is null', () => {
    expect(reminderLayerFromWords('geen')).toEqual({ mode: 'replace', rules: [] });
    expect(reminderLayerFromWords('none')).toEqual({ mode: 'replace', rules: [] });
    expect(reminderLayerFromWords('60 straks')).toBeNull();
    expect(reminderLayerFromWords('')).toBeNull();
    expect(reminderLayerFromWords('ook')).toBeNull();
  });

  it("the household's list: today's rhythm by default; the lead is its before: rule", () => {
    expect(HOUSEHOLD_RULES_DEFAULT).toEqual(['morning', 'evening-before', 'before:5']);
    expect(reminderRulesFrom(undefined)).toEqual(HOUSEHOLD_RULES_DEFAULT);
    expect(reminderRulesFrom('morning,before:15')).toEqual(['morning', 'before:15']);
    expect(reminderRulesFrom('none')).toEqual([]);
    expect(reminderRulesFrom('morning,every-hour')).toEqual(HOUSEHOLD_RULES_DEFAULT);
    expect(leadOf(['morning', 'before:15'])).toBe(15);
    expect(leadOf(['morning'])).toBe(0);
    expect(withLead(['morning', 'evening-before', 'before:5'], 30)).toEqual(['morning', 'evening-before', 'before:30']);
    expect(withLead(['morning', 'before:5'], 0)).toEqual(['morning']);
  });
});
