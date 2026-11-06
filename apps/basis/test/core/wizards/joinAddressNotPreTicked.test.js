/**
 * THE JOIN'S ADDRESS SHARE IS NOT PRE-TICKED, AND IT SAYS WHAT YOU THEN CANNOT DO.
 *
 * The walk's join showed "Share my address so other members can reach me directly (recommended for catch-up)", ticked
 * before the person had read it; "address" and "catch-up" meant nothing to them. Ruled in the sitting: strict by default,
 * with one line saying what being off costs.
 */
import { describe, it, expect } from 'vitest';
import { initialState } from '../../../src/core/wizards/joinGroupState.js';
import en from '../../../src/locales/circle.en.json' with { type: 'json' };
import nl from '../../../src/locales/circle.nl.json' with { type: 'json' };

describe('the join wizard\'s address share', () => {
  it('starts unticked', () => {
    expect(initialState().shareAddress).toBe(false);
  });
  it('says it in plain words, both languages, without "address", "catch-up" or a dash', () => {
    for (const d of [en, nl]) {
      const p = d.join.wizard.privacy;
      for (const w of [p.mesh.text, p.mesh_hint.text, p.notice.text]) {
        expect(w).not.toMatch(/address|adres|catch-up|bijwerken|—| = /);
      }
    }
  });
});
