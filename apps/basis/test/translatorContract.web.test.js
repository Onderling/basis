/**
 * WEB half of the translator contract — the table in `src/locales/translatorContract.js`, fed to
 * i18next as this shell configures it. Its mobile twin is `apps/basis-mobile/test/translatorContract.mobile.test.js`
 * and asserts the SAME table. If the two ever disagree, one of them goes red rather than a phone
 * quietly rendering something a browser does not.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { TRANSLATOR_CONTRACT } from '../src/locales/translatorContract.js';
import { initLocalisation, t } from '../src/localisation.js';

describe('translator contract — web (i18next)', () => {
  beforeAll(async () => { await initLocalisation({ lng: 'en' }); });

  it('the table is shared, non-empty and frozen (one source, two runners)', () => {
    expect(Object.isFrozen(TRANSLATOR_CONTRACT)).toBe(true);
    expect(TRANSLATOR_CONTRACT.length).toBeGreaterThan(10);
  });

  for (const c of TRANSLATOR_CONTRACT) {
    it(c.name, () => {
      expect(t(c.key, c.params, c.lang)).toBe(c.expect);
    });
  }
});
