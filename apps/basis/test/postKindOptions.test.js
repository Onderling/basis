/**
 * The post kinds a shell offers come from ONE place: the noticeboard's declared intents. The web offered
 * ask / offer / lend and the phone ask / offer / announce — two lists, one of them inventing a kind the
 * item type does not declare.
 */
import { describe, it, expect } from 'vitest';
import { NOTICEBOARD_INTENTS } from '@onderling/item-types';
import { postKindOptions } from '../src/core/wizards/postAudienceState.js';
import { readFileSync } from 'node:fs';
import en from '../src/locales/circle.en.json' with { type: 'json' };

describe('postKindOptions', () => {
  it('is exactly the declared intents, each with its label key', () => {
    expect(postKindOptions().map((o) => o.id)).toEqual([...NOTICEBOARD_INTENTS]);
    for (const o of postKindOptions()) {
      const leaf = o.labelKey.replace(/^circle\./, '').split('.').reduce((n, k) => n?.[k], en);
      expect(leaf?.text, o.labelKey).toBeTruthy();
    }
  });

  it('both shells paint the post kinds from it — no shell keeps a list of its own', () => {
    for (const f of ['../src/web/wizards/postAudienceWizard.js', '../src/rn/wizards/postAudienceWizardModal.js']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).toMatch(/postKindOptions\(\)/);
      expect(src, f).not.toMatch(/audience\.kind_(ask|offer|lend|announce)/);
    }
  });
});
