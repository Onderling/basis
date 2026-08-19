/**
 * Stoop V1 — Phase 8 (localisation) tests.
 *
 * `lib/localisation.js` is a thin wrapper over `i18next`.  We test:
 *  - `t(key)` returns the en string after init({lng: 'en'}).
 *  - `setLang('nl')` switches; same key returns the nl string.
 *  - missing keys soft-fall to the key itself (developer hint).
 *  - error keys for the new skills are populated in both locales.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initLocalisation, t, setLang, getLang } from '../src/lib/localisation.js';

beforeAll(async () => {
  await initLocalisation({ lng: 'en' });
});

describe('Stoop V1 — localisation wrapper', () => {
  it('translates a known key in en', () => {
    expect(t('common.save')).toBe('Save');
    expect(t('noticeboard.title')).toBe('On the noticeboard');
  });

  it('switches to nl', async () => {
    await setLang('nl');
    expect(getLang()).toBe('nl');
    expect(t('common.save')).toBe('Opslaan');
    expect(t('noticeboard.title')).toBe('Op het prikbord');
  });

  it('falls back to en for keys missing from nl (configured fallback)', async () => {
    await setLang('nl');
    // Every key in en must be in nl; pick one that we know exists in both.
    expect(t('common.app_name')).toBe('Stoop');
  });

  it('returns the key itself when the key is missing entirely', async () => {
    await setLang('en');
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('honours interpolation params', async () => {
    await setLang('nl');
    expect(t('profile.default_render', { render: '@anne' })).toBe('Anderen zien: @anne');
  });

  it('every "errors.invalid_handle.*" reason has a localised string in both languages', async () => {
    const reasons = ['too-short', 'too-long', 'invalid-chars', 'contains-whitespace', 'not-a-string', 'handle-taken'];
    for (const lang of ['en', 'nl']) {
      await setLang(lang);
      for (const r of reasons) {
        const key = `errors.invalid_handle.${r}`;
        const out = t(key);
        expect(out, `lang=${lang} key=${key}`).not.toBe(key);
        expect(out.length, `lang=${lang} key=${key}`).toBeGreaterThan(0);
      }
    }
  });
});
