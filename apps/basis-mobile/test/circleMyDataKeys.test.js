/**
 * S5 (mobile) — CircleMyDataScreen's key-management section is locale-driven:
 * the screen surfaces "back up · reveal recovery phrase · restore" + the reveal
 * dialog through `circle.mydata.*` keys that now live in the shared basis
 * source (one place, web ≡ mobile). Following the portable-vitest cadence we
 * cover the locale keys the screen resolves rather than spinning up RN render
 * infra — the backup/restore flows reuse the existing RN wizard modals.
 */
import { describe, it, expect } from 'vitest';
import { sharedCircleLocale } from '@onderling-app/basis';

// `close` left this set on 2026-08-31: four blocks each carried their own "Close"/"Sluiten", so the
// screen now reads the one `common.close` in the shared host block. The section's OWN words stay here.
const KEYS = ['keys', 'backup', 'view_mnemonic', 'restore', 'mnemonic_title', 'mnemonic_warn', 'mnemonic_none'];

describe('mobile My-data key-management locale (shared circle source)', () => {
  for (const lang of ['en', 'nl']) {
    it(`resolves every circle.mydata key-management string in ${lang}`, () => {
      const mydata = sharedCircleLocale[lang]?.mydata ?? {};
      for (const k of KEYS) {
        const node = mydata[k];
        const text = typeof node === 'object' ? node.text : node;
        expect(text, `${lang}.circle.mydata.${k}`).toBeTruthy();
        expect(String(text).length).toBeGreaterThan(0);
      }
    });
  }

  it('the close control reads the ONE shared close, not a fourth copy of the word', () => {
    // The duplication this replaced: circle.join.wizard.close, circle.guided.close, circle.mydata.close
    // and circle.wizard.settings.close, four keys with one value, drifting independently by definition.
    for (const lang of ['en', 'nl']) {
      expect(sharedCircleLocale[lang].mydata.close, 'the per-block copy is gone').toBeUndefined();
    }
  });

  it('keeps web ≡ mobile: the same key set exists in both locales', () => {
    const en = Object.keys(sharedCircleLocale.en.mydata);
    const nl = Object.keys(sharedCircleLocale.nl.mydata);
    expect(new Set(nl)).toEqual(new Set(en));
    for (const k of KEYS) expect(en).toContain(k);
  });
});
