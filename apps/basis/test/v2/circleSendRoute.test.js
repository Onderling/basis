/**
 * HOW A CIRCLE-SCOPED SEND MAY SPEAK — the privacy guarantee in one decision. A circle member is reached at their
 * circle address as my circle address; a member reached at their GLOBAL key (the fan's pubkey/webid rung) is reached
 * person to person, as my person key — and ONLY when the person chose the address fallback. With the fallback off that
 * send is refused: never my circle address to their global key, never my global self behind the person's back.
 */
import { describe, it, expect } from 'vitest';
import { circleSendRoute } from '../../src/v2/circleSendRoute.js';

describe('circleSendRoute', () => {
  it('a member reached at their circle address: as the circle, whatever the fallback says', () => {
    expect(circleSendRoute({ asPerson: false, fallbackOn: false })).toBe('circle');
    expect(circleSendRoute({ asPerson: false, fallbackOn: true })).toBe('circle');
  });
  it('a member reached at their global key, with the person\'s fallback ON: person to person', () => {
    expect(circleSendRoute({ asPerson: true, fallbackOn: true })).toBe('person');
  });
  it('…with the fallback OFF: REFUSED — the mix never leaves, and nothing speaks to a global key unasked', () => {
    expect(circleSendRoute({ asPerson: true, fallbackOn: false })).toBe('refuse');
    expect(circleSendRoute({ asPerson: true })).toBe('refuse');
    expect(circleSendRoute({ asPerson: true, fallbackOn: 'yes' }), 'only an explicit true opens it').toBe('refuse');
  });
});
