/**
 * MOBILE half of the translator contract — the same table as `apps/basis/test/translatorContract.web.test.js`,
 * fed to this shell's hand-rolled `t()`. The table lives once, in the basis package beside the shared
 * locale files it draws its keys from; both shells run it.
 *
 * Two of its rows exist because this implementation used to differ: the plural pair (which it ignored
 * entirely until 2026-08-31) and `defaultValue` (which it still ignored after that, so five calls that
 * read fine in a browser rendered raw keys on a phone).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { TRANSLATOR_CONTRACT } from '../../basis/src/locales/translatorContract.js';
import { initLocalisation, t } from '../src/core/localisation.js';

describe('translator contract — mobile (hand-rolled)', () => {
  beforeAll(async () => { await initLocalisation({ lng: 'en' }); });

  it('runs the SAME table as web (a divergence must fail somewhere, not render)', () => {
    expect(Object.isFrozen(TRANSLATOR_CONTRACT)).toBe(true);
    expect(TRANSLATOR_CONTRACT.length).toBeGreaterThan(10);
  });

  for (const c of TRANSLATOR_CONTRACT) {
    it(c.name, () => {
      expect(t(c.key, c.params, c.lang)).toBe(c.expect);
    });
  }
});
