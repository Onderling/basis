/**
 * N2 (mobile) — the mobile locale bundles carry every consequence the
 * registry expects, so the create-wizard / skill-editor ⓘ resolves to
 * real text on RN.  Mirrors the web drift-guard, against the mobile
 * en/nl bundles.
 */
import { describe, it, expect } from 'vitest';

import { CONSEQUENCE_OPTIONS, consequenceKeyFor, attachConsequences, sharedConsequenceLocale } from '@onderling-app/basis';
import enRaw from '../locales/en.json';
import nlRaw from '../locales/nl.json';
// `consequence.*` now lives in the shared source (like `circle.*`), merged into both shells; merge it
// back here to check the effective mobile bundle the way the loader assembles it.
const en = { ...enRaw, consequence: sharedConsequenceLocale.en };
const nl = { ...nlRaw, consequence: sharedConsequenceLocale.nl };

describe('mobile consequence locales', () => {
  it('every registered option has en + nl consequence text', () => {
    for (const [group, opts] of Object.entries(CONSEQUENCE_OPTIONS)) {
      for (const opt of opts) {
        expect(en.consequence?.[group]?.[opt]?.text, `en ${group}.${opt}`).toBeTruthy();
        expect(nl.consequence?.[group]?.[opt]?.text, `nl ${group}.${opt}`).toBeTruthy();
      }
    }
  });

  it('common.consequences (ⓘ label) exists on mobile', () => {
    expect(en.common?.consequences?.text).toBeTruthy();
    expect(nl.common?.consequences?.text).toBeTruthy();
  });

  it('attachConsequences with a real mobile-locale lookup yields text', () => {
    // Simulate the wizard's t() against the en bundle.
    const t = (k) => {
      const node = k.split('.').reduce((o, seg) => (o == null ? o : o[seg]), en);
      return node?.text ?? k;
    };
    const out = attachConsequences('kind', [{ id: 'neighbourhood', label: 'B' }], t);
    expect(out[0].consequence).toBe(en.consequence.kind.neighbourhood.text);
    expect(consequenceKeyFor('kind', 'neighbourhood')).toBe('consequence.kind.neighbourhood');
  });
});
