/**
 * What a shown noun is CALLED comes from the manifest that declares it (`names`, its plural forms per language), merged
 * into the shared locale as `noun.<noun>_one` / `_other` — so basis's own locale carries no noun's name, and a bot's
 * noun is named the moment it declares it.
 */
import { describe, it, expect } from 'vitest';
import { CANONICAL_TYPES } from '@onderling/item-types';
import { nounWords, nounHeading, nounWord } from '../../src/v2/nounNames.js';
import { presenterFor } from '../../src/v2/declaredPresenters.js';
import { sharedLocale } from '../../src/locales/index.js';
import { PLUS_ACTS, plusLabel } from '../../src/v2/vandaagPlus.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };
import en from '../../src/locales/circle.en.json' with { type: 'json' };

const tFrom = (block) => (key, o = {}) => {
  const k = key.replace(/^noun\./, '');
  const leaf = block[`${k}_${o.count === 1 ? 'one' : 'other'}`] ?? block[`${k}_other`];
  return leaf?.text ?? key;
};

describe('a noun is named by its manifest', () => {
  it('a bot\'s noun is named from its declaration, in each language', () => {
    const manifests = [{ app: 'repairbot', nouns: { repair: { atoms: ['list'], names: { nl: { one: 'reparatie', other: 'reparaties' }, en: { other: 'repairs' } } } } }];
    const w = nounWords({ manifests });
    expect(w.nl.repair_one.text).toBe('reparatie');
    expect(w.nl.repair_other.text).toBe('reparaties');
    expect(w.en.repair_other.text).toBe('repairs');
    expect(w.en.repair_one).toBeUndefined();   // `one` is optional: the shells fall back to `other`
  });

  it('a heading is the plural form, capitalised; a word in a sentence is as declared', () => {
    const t = tFrom(nounWords().nl);
    expect(nounHeading(t, 'calendar-event')).toBe('Afspraken');
    expect(nounWord(t, 'calendar-event')).toBe('afspraak');
  });

  it('every noun a merged view shows says its name in both languages', () => {
    for (const noun of Object.keys(CANONICAL_TYPES).filter((n) => presenterFor(n))) {
      expect(sharedLocale.nl.noun?.[`${noun}_other`]?.text, `nl ${noun}`).toBeTruthy();
      expect(sharedLocale.en.noun?.[`${noun}_other`]?.text, `en ${noun}`).toBeTruthy();
    }
  });

  it('basis\'s own locale names no shown noun: no per-noun headings, no "+" words of its own', () => {
    for (const bundle of [nl, en]) {
      expect(bundle.screen.items_title).toBeUndefined();
      expect(bundle.vandaag.plus_note).toBeUndefined();
      expect(bundle.vandaag.plus_appointment).toBeUndefined();
    }
  });

  it('the "+" says what it makes in the declaring manifest\'s word', () => {
    const t = (key, o = {}) => (key === 'circle.vandaag.plus_own' ? `Eigen ${o.noun}` : tFrom(nounWords().nl)(key, o));
    expect(PLUS_ACTS.map((a) => plusLabel(t, a))).toEqual(['Eigen notitie', 'Eigen afspraak']);
  });
});
