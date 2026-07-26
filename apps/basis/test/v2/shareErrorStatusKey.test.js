/**
 * A share refusal must read as something a person can act on.
 *
 * Both shells used to interpolate the raw machine code into "Share failed: {{error}}.", so the
 * `seal-unavailable` refusal added on 2026-07-26 (story 7.3) would have surfaced as
 * `Share failed: seal-unavailable.` — technically honest, practically useless. `shareErrorStatusKey` maps
 * each known code to a full sentence and leaves anything unknown on the old template, so a NEW error code
 * can never render as a missing string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shareErrorStatusKey } from '../../src/v2/circleShare.js';

const locale = (lang) => JSON.parse(readFileSync(new URL(`../../src/locales/circle.${lang}.json`, import.meta.url), 'utf8'));
const at = (obj, key) => key.replace(/^circle\./, '').split('.').reduce((o, k) => o?.[k], obj);

const KNOWN = [
  'seal-unavailable', 'sharing-closed', 'sharing-admin-only', 'share-prohibited',
  'posture-floor', 'no-stores', 'same-circle', 'missing-args', 'not-canonical',
];

describe('shareErrorStatusKey', () => {
  it.each(KNOWN)('%s maps to a sentence that exists in BOTH locales', (code) => {
    const key = shareErrorStatusKey(code);
    expect(key).toBe(`circle.share.error.${code.replace(/-/g, '_')}`);
    for (const lang of ['en', 'nl']) {
      const entry = at(locale(lang), key);
      expect(entry?.text, `${lang} is missing ${key}`).toBeTruthy();
      expect(entry.text).not.toContain('{{');          // a complete sentence, not a template
      expect(entry.text.length).toBeGreaterThan(15);   // …and an actual explanation
    }
  });

  it('the seal-unavailable text tells the person what to DO, not what broke', () => {
    const en = at(locale('en'), shareErrorStatusKey('seal-unavailable')).text;
    expect(en.toLowerCase()).toContain('pod');
    expect(en.toLowerCase()).toContain('nothing was shared');   // the reassurance that matters
    expect(en).not.toContain('seal-unavailable');               // never the machine code
  });

  it('an UNKNOWN code falls back to the generic template — never a missing string', () => {
    for (const code of ['some-future-error', '', null, undefined]) {
      expect(shareErrorStatusKey(code)).toBe('circle.share.failed');
    }
    expect(at(locale('en'), 'circle.share.failed').text).toContain('{{error}}');
  });

  it('en and nl declare the SAME set of error keys (no half-translated refusal)', () => {
    const keys = (lang) => Object.keys(at(locale(lang), 'circle.share.error')).sort();
    expect(keys('nl')).toEqual(keys('en'));
    expect(keys('en')).toEqual(KNOWN.map((c) => c.replace(/-/g, '_')).sort());
  });

  it('the nl strings are actually Dutch, not copied English', () => {
    const en = at(locale('en'), 'circle.share.error');
    const nl = at(locale('nl'), 'circle.share.error');
    for (const k of Object.keys(en)) expect(nl[k].text, `${k} was not translated`).not.toBe(en[k].text);
  });
});
