// An invite's refusal crosses the wire from the inviter's device to the joiner's: a CODE from one closed set, never the
// text of an exception, and every code has a sentence on the joiner's side.
import { describe, it, expect } from 'vitest';
import { INVITE_REFUSALS, inviteRefusalOf, inviteRefusalKey } from '../../src/v2/inviteRefusals.js';
import en from '../../src/locales/circle.en.json';
import nl from '../../src/locales/circle.nl.json';

const has = (bundle, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), bundle) !== undefined;

describe('invite refusals: one closed set, a sentence each', () => {
  it('a known code is itself; anything else is the catch-all', () => {
    for (const c of INVITE_REFUSALS) expect(inviteRefusalOf(c)).toBe(c);
    expect(inviteRefusalOf('db down at /var/x')).toBe('join-refused');
    expect(inviteRefusalOf(null)).toBe('join-refused');
    expect(inviteRefusalOf({ error: 'x' })).toBe('join-refused');
  });
  it('every code has a locale key in both languages', () => {
    for (const c of INVITE_REFUSALS) {
      const key = inviteRefusalKey(c);
      expect(key, c).toMatch(/^circle\./);
      expect(has(en, key), `${key} (en)`).toBe(true);
      expect(has(nl, key), `${key} (nl)`).toBe(true);
    }
  });
});
