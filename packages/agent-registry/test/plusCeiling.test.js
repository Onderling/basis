/**
 * How far the person's own "+" goes for a persona (ledger L977): 0 hidden (the "+" is off for it), 1 only looks things
 * up, 2 also makes and changes the person's own things, 3 also a circle's things after their yes on a card (the
 * default). Kept on the persona, inherited from the default persona like any property; a machine key, so the
 * person-facing property op refuses it and only its own op writes it.
 */
import { describe, it, expect } from 'vitest';
import { PLUS_CEILING_KEY, PLUS_CEILINGS, PLUS_CEILING_DEFAULT, plusCeilingFor, isPlusCeiling } from '../src/plusCeiling.js';
import { isReservedPropertyKey } from '../src/reservedProperties.js';
import { own } from '../src/profileProperties.js';

const book = (profiles) => (id) => profiles[id] ?? null;

describe('the ceiling of the "+" per persona', () => {
  it('four values, 3 by default', () => {
    expect(PLUS_CEILINGS).toEqual([0, 1, 2, 3]);
    expect(PLUS_CEILING_DEFAULT).toBe(3);
    expect([0, 3].every(isPlusCeiling)).toBe(true);
    expect([4, -1, '2', null].some(isPlusCeiling)).toBe(false);
  });
  it('its own word, else the default persona\'s, else 3', () => {
    const get = book({ me: { properties: { [PLUS_CEILING_KEY]: own(1) } }, werk: { properties: {} }, club: { properties: { [PLUS_CEILING_KEY]: own(0) } } });
    expect(plusCeilingFor(get, 'club', { defaultProfileId: 'me' })).toBe(0);
    expect(plusCeilingFor(get, 'werk', { defaultProfileId: 'me' })).toBe(1);
    expect(plusCeilingFor(book({ werk: { properties: {} } }), 'werk')).toBe(3);
  });
  it('a value that is not one of the four reads as the default', () => {
    expect(plusCeilingFor(book({ x: { properties: { [PLUS_CEILING_KEY]: own(7) } } }), 'x')).toBe(3);
  });
  it('is the registry\'s own key: the person-facing property op refuses it', () => {
    expect(isReservedPropertyKey(PLUS_CEILING_KEY)).toBe(true);
  });
});
