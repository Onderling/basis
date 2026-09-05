// @vitest-environment node
// Per-circle privacy state (property-layer §10c) — the discrete indicator model.
import { describe, it, expect } from 'vitest';
import { charterFromConfig, emptyConsent, setConsentValue, toggleConsent } from '../src/v2/charterConsent.js';
import { circlePrivacyState } from '../src/v2/circlePrivacyState.js';

const charter = charterFromConfig('circle-42', { attributes: [
  { key: 'place', purpose: 'circles' }, { key: 'ageBand', purpose: 'age' }, { key: 'role', purpose: 'role' },
] });
const share = (keys) => {
  let c = emptyConsent('circle-42');
  for (const [k, v] of keys) c = toggleConsent(setConsentValue(c, k, v), k, true);
  return c;
};

describe('circlePrivacyState', () => {
  it('is not applicable without a charter (nothing to show → hide it)', () => {
    expect(circlePrivacyState({ charter: null }).applicable).toBe(false);
  });

  it('quiet when nothing is shared', () => {
    expect(circlePrivacyState({ charter, consent: emptyConsent('circle-42') }))
      .toMatchObject({ applicable: true, level: 'quiet', shared: [], warn: false });
  });

  it('sharing (no risk) when a coarse detail is shared but the combo is not identifying', () => {
    const s = circlePrivacyState({ charter, consent: share([['place', 'Groningen']]), n: 100 });
    expect(s.level).toBe('sharing');
    expect(s.warn).toBe(false);
    expect(s.shared).toEqual(['place']);
  });

  it('⚠ risk when the enabled combo is likely identifying in a small cohort', () => {
    const s = circlePrivacyState({ charter, consent: share([['ageBand', '35-54'], ['role', 'resident']]), n: 8 });
    expect(s.level).toBe('risk');
    expect(s.reason).toBe('combo-identifiable');
  });

  it('graduated: minimal mode warns only on NEAR-certain uniqueness (stricter than normal)', () => {
    const c = share([['ageBand', '35-54'], ['role', 'resident']]);   // 4×4 = 16 combos
    expect(circlePrivacyState({ charter, consent: c, n: 8, warningsMode: 'normal' }).level).toBe('risk');     // 16 > 8
    expect(circlePrivacyState({ charter, consent: c, n: 8, warningsMode: 'minimal' }).level).toBe('sharing'); // 16 < 8×4 → not near-certain
    // in a tiny cohort even minimal warns
    expect(circlePrivacyState({ charter, consent: c, n: 3, warningsMode: 'minimal' }).level).toBe('risk');    // 16 > 3×4=12
  });

  it('⚠ risk (structural) when warnings are OFF while still sharing — the "regret later" case', () => {
    const s = circlePrivacyState({ charter, consent: share([['place', 'Groningen']]), warningsMode: 'off' });
    expect(s.level).toBe('risk');
    expect(s.reason).toBe('warnings-off');
  });

  it('no identifiability ⚠ without a cohort size (inert until n is wired) — but sharing still shows', () => {
    const s = circlePrivacyState({ charter, consent: share([['ageBand', '35-54'], ['role', 'resident']]) });   // no n
    expect(s.level).toBe('sharing');   // can't assess identifiability without n → not risk
    expect(s.warn).toBe(false);
  });
});
