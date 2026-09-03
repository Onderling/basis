/**
 * The join wizard says WHICH wait you are on.
 *
 * Walked on a phone: the redeem answered in about a second and the wizard then sat on one
 * undifferentiated "Joining…" for ~40 s while the post-join reachability work ran — registering this
 * device's per-circle address across every circle it is in and re-reading the roster. The membership
 * was already real the whole time. The stage lives on the join state (where the chain is); both
 * wizards render it through `joinSubmitLabelKey`.
 */
import { describe, it, expect, vi } from 'vitest';
import { joinSubmitLabelKey } from '../../src/core/wizards/joinGroupState.js';

describe('joinSubmitLabelKey', () => {
  it('names the redeem while redeeming and the connection while connecting', () => {
    expect(joinSubmitLabelKey({ submitStage: 'redeeming' })).toBe('circle.join.wizard.submitting');
    expect(joinSubmitLabelKey({ submitStage: 'connecting' })).toBe('circle.join.wizard.submitting_connecting');
  });

  it('falls back to the first line for an unknown or missing stage', () => {
    expect(joinSubmitLabelKey({})).toBe('circle.join.wizard.submitting');
    expect(joinSubmitLabelKey(null)).toBe('circle.join.wizard.submitting');
  });

  it('both keys exist in both locales', async () => {
    const { readFileSync } = await import('node:fs');
    for (const lang of ['en', 'nl']) {
      const json = JSON.parse(readFileSync(new URL(`../../src/locales/circle.${lang}.json`, import.meta.url), 'utf8'));
      const w = json.join.wizard;   // the file is already circle-scoped
      expect(w.submitting?.text, lang).toBeTruthy();
      expect(w.submitting_connecting?.text, lang).toBeTruthy();
    }
  });
});
