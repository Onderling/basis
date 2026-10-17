/**
 * loadLocale — substrate-level coverage. The end-to-end Pinboard locale
 * resolution is exercised in apps/pinboard-mobile/test/localisation.test.js
 * (which now goes through this substrate).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { loadLocale } from '../../src/localisation/loadLocale.js';

const EN = {
  greeting: { text: 'Hello', doc: 'Generic greeting' },
  ui: {
    nav: {
      home: { text: 'Home', doc: '' },
    },
  },
  count: { text: 'You have {count} unread', doc: 'Inbox count' },
};
const NL = {
  greeting: { text: 'Hallo', doc: 'Generic greeting' },
  ui: {
    nav: {
      home: { text: 'Thuis', doc: '' },
    },
  },
  count: { text: 'Je hebt {count} ongelezen', doc: 'Inbox count' },
};

describe('loadLocale — input validation', () => {
  it('throws when bundles is missing', () => {
    expect(() => loadLocale()).toThrow(/bundles map required/);
  });
  it('throws when defaultLang has no bundle', () => {
    expect(() => loadLocale({ bundles: { en: EN }, defaultLang: 'fr' }))
      .toThrow(/defaultLang/);
  });
});

describe('loadLocale — basic flow', () => {
  let localisation;
  beforeEach(() => { localisation = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' }); });

  it('starts on the default language, not initialised', () => {
    expect(localisation.currentLang()).toBe('en');
    expect(localisation.isInitialised()).toBe(false);
  });

  it('initLocalisation marks initialised', async () => {
    await localisation.initLocalisation({ lng: 'nl' });
    expect(localisation.currentLang()).toBe('nl');
    expect(localisation.isInitialised()).toBe(true);
  });

  it('falls back to default on unknown language', async () => {
    await localisation.setLang('zh');
    expect(localisation.currentLang()).toBe('en');
  });
});

describe('loadLocale — t() + format()', () => {
  let localisation;
  beforeEach(() => { localisation = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' }); });

  it('unwraps {text, doc} leaves', () => {
    expect(localisation.t('greeting')).toBe('Hello');
  });

  it('walks dotted paths', () => {
    expect(localisation.t('ui.nav.home')).toBe('Home');
  });

  it('returns fallback (or key) when not found', () => {
    expect(localisation.t('missing.key', 'default')).toBe('default');
    expect(localisation.t('missing.key')).toBe('missing.key');
  });

  it('switches bundle on setLang', async () => {
    await localisation.setLang('nl');
    expect(localisation.t('greeting')).toBe('Hallo');
    expect(localisation.t('ui.nav.home')).toBe('Thuis');
  });

  it('format() interpolates {param}', () => {
    expect(localisation.format('count', { count: 3 })).toBe('You have 3 unread');
  });
});

describe('loadLocale — multi-instance isolation', () => {
  it('two instances do not share state', async () => {
    const a = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' });
    const b = loadLocale({ bundles: { en: EN, nl: NL }, defaultLang: 'en' });
    await a.setLang('nl');
    expect(a.currentLang()).toBe('nl');
    expect(b.currentLang()).toBe('en');
  });
});
