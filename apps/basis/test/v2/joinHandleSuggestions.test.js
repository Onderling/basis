/**
 * The handle suggestions on the join wizard's third step (S3, seen on a device 2026-07-30).
 *
 * They rendered as an empty pill, `-29` and `.2026`, and changed on every re-render — so a chip someone
 * was reaching for moved under their finger. Three separate mistakes in four lines, and the third is the
 * one worth remembering: nothing checked the output against `isValidHandle`, which lives in the same file
 * a few lines above and is the exact rule the field itself enforces.
 */
import { describe, it, expect } from 'vitest';
import { handleSuggestions, isValidHandle } from '../../src/core/wizards/joinGroupState.js';

describe('every suggestion is something the field would actually accept', () => {
  for (const name of ['Anna de Vries', 'Bo', 'x', 'ANNA', 'anna_v', 'Jan-Willem']) {
    it(`"${name}" produces only valid handles`, () => {
      for (const s of handleSuggestions([], name)) expect(isValidHandle(s), s).toBe(true);
    });
  }

  it('no name to work from ⇒ no suggestions, rather than invented ones', () => {
    // The old fallback was `'me'` — not even a valid handle (the rule wants 3+ characters), and an
    // English word invented as someone's name in a Dutch-first product. An empty list is honest.
    expect(handleSuggestions([], '')).toEqual([]);
    expect(handleSuggestions([], undefined)).toEqual([]);
    expect(handleSuggestions([], '!!!')).toEqual([]);
  });

  it('is STABLE — the same input gives the same chips', () => {
    // `Math.random()` made them move between renders.
    expect(handleSuggestions([], 'Anna')).toEqual(handleSuggestions([], 'Anna'));
  });

  it('a person’s own prior handles still win over anything derived', () => {
    // Unchanged behaviour, asserted so the fix above cannot quietly displace it: your own handles leak
    // nothing and are the better suggestion.
    expect(handleSuggestions(['annav', 'buurvrouw'], 'Anna')).toEqual(['annav', 'buurvrouw']);
  });

  it('…and an invalid prior handle is not offered back', () => {
    expect(handleSuggestions(['no', '!!'], 'Anna')).toEqual(['anna', 'anna-2026', 'anna2']);
  });
});
