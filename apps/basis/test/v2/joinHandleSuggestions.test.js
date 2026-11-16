/**
 * The name suggestions in the join wizard's fold (S3, seen on a device 2026-07-30; the name rule changed 2026-11-06).
 *
 * They once rendered as an empty pill, `-29` and `.2026`, and changed on every re-render, so a chip someone was
 * reaching for moved under their finger. The lesson that stays: every suggestion must pass the rule the field
 * itself applies (`isValidName`). Since the name is for people, a suggestion is a name as written, never a
 * lowercased or numbered variant of it.
 */
import { describe, it, expect } from 'vitest';
import { handleSuggestions, isValidName } from '../../src/core/wizards/joinGroupState.js';

describe('every suggestion is something the field would actually accept', () => {
  for (const name of ['Anna de Vries', 'Bo', 'x', 'ANNA', 'anna_v', 'Jan-Willem']) {
    it(`"${name}" is offered as written`, () => {
      const out = handleSuggestions([], name);
      expect(out).toEqual([name]);
      for (const s of out) expect(isValidName(s), s).toBe(true);
    });
  }

  it('no name to work from ⇒ no suggestions, rather than invented ones', () => {
    expect(handleSuggestions([], '')).toEqual([]);
    expect(handleSuggestions([], undefined)).toEqual([]);
    expect(handleSuggestions([], '   ')).toEqual([]);
  });

  it('is STABLE — the same input gives the same chips', () => {
    expect(handleSuggestions([], 'Anna')).toEqual(handleSuggestions([], 'Anna'));
  });

  it('a person’s own prior names win over their own name', () => {
    expect(handleSuggestions(['Annav', 'buurvrouw'], 'Anna')).toEqual(['Annav', 'buurvrouw']);
  });

  it('…and an invalid prior name is not offered back', () => {
    expect(handleSuggestions(['   ', 'a\u0007'], 'Anna')).toEqual(['Anna']);
  });
});
