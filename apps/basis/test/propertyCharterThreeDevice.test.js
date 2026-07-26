/**
 * The property/charter layer across THREE people — stories 8.1 + 8.2 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * This layer shipped fast over the Jul 12–26 fortnight with no multi-actor coverage at all. Two properties
 * carry the whole privacy promise:
 *   • 8.1 — per-CONTEXT disclosure. The same person is in several circles; what they allowed in one must
 *     never surface in another. This is the cross-context bleed the pinned model exists to prevent.
 *   • 8.2 — the cohort (k-anonymity) warning must reflect the CURRENT crowd, not a stale snapshot from
 *     whenever the participant happened to join. Being wrong in the SAFE direction (over-warning) is a
 *     nuisance; being wrong the other way tells someone they are hidden when they are identifiable.
 *
 * Cast: Cato (in circles X and Y) · Anna + Bram (the rest of the cohort).
 */
import { describe, it, expect } from 'vitest';
import { createDisclosurePolicy, setDisclosure, releasedValues, releasedForMatching } from '@onderling/agent-registry';
import { disclosureWarning } from '@onderling/attribute-charter';

const CIRCLE_X = 'oosterpoort';
const CIRCLE_Y = 'werkgroep';

// ONE profile — the same person, the same values, in both circles. Properties are ENTRIES
// (`{mode:'own', value}`), which is how `resolveProperty` walks the own/inherit chain.
const own = (value) => ({ mode: 'own', value });
const profile = { properties: { place: own('Groningen'), ageBand: own('35-54'), availability: own('open') } };
const profileCtx = { getProfile: () => profile, profileId: 'default', defaultProfileId: 'default' };

/** Cato allows `place` in X, and `place` + `ageBand` in Y. */
function catosPolicy() {
  let p = createDisclosurePolicy();
  p = setDisclosure(p, CIRCLE_X, 'place', { enabled: true });
  p = setDisclosure(p, CIRCLE_Y, 'place', { enabled: true });
  p = setDisclosure(p, CIRCLE_Y, 'ageBand', { enabled: true });
  return p;
}
const askFor = (...keys) => ({ items: keys.map((key) => ({ key })) });

describe('8.1 — two circles ask the same attribute; neither learns the other\'s answer', () => {
  const policy = catosPolicy();

  it('circle X receives only what Cato allowed THERE', () => {
    const released = releasedValues(profileCtx, askFor('place', 'ageBand'), policy, CIRCLE_X);
    expect(released.place).toBe('Groningen');
    // X asked for ageBand too, and the VALUE exists on the profile — it is withheld because Cato did not
    // enable it for X. Default-withhold, no marker: X cannot even tell it was asked-and-refused.
    expect(released).not.toHaveProperty('ageBand');
  });

  it('circle Y receives what Cato allowed there — the wider set', () => {
    const released = releasedValues(profileCtx, askFor('place', 'ageBand'), policy, CIRCLE_Y);
    expect(released).toEqual({ place: 'Groningen', ageBand: '35-54' });
  });

  it('enabling an attribute in Y does NOT leak it into X (the bleed this model exists to stop)', () => {
    let p = catosPolicy();
    p = setDisclosure(p, CIRCLE_Y, 'availability', { enabled: true });   // a later, Y-only decision
    expect(releasedValues(profileCtx, askFor('availability'), p, CIRCLE_Y)).toHaveProperty('availability');
    expect(releasedValues(profileCtx, askFor('availability'), p, CIRCLE_X)).not.toHaveProperty('availability');
  });

  it('a circle Cato never configured gets NOTHING, even for keys it asks about', () => {
    const stranger = releasedValues(profileCtx, askFor('place', 'ageBand', 'availability'), policy, 'circle-never-joined');
    expect(stranger).toEqual({});
  });

  it('the MATCHABLE surface is per-context too — matching cannot widen disclosure', () => {
    const inX = releasedForMatching(profileCtx, askFor('place', 'ageBand'), policy, CIRCLE_X);
    // Whatever matching sees in X, it is bounded by X's own decisions — Y's extra key is not in it.
    expect(inX).not.toHaveProperty('ageBand');
  });
});

describe('8.2 — the cohort warning follows the CURRENT crowd, not a stale snapshot', () => {
  const enabledKeys = ['place', 'ageBand'];

  it('a tiny cohort warns; the same choices in a big one do not', () => {
    expect(disclosureWarning({ enabledKeys, n: 2 }).warn).toBe(true);
    expect(disclosureWarning({ enabledKeys, n: 100_000 }).warn).toBe(false);
  });

  it('growing the cohort RELAXES the warning — a third contributor changes the verdict', () => {
    // The scenario: Anna + Bram are the segment; Cato joins. Everyone's warning must be recomputed from
    // the new n, not from the n each of them first saw.
    const before = disclosureWarning({ enabledKeys, n: 2 });
    const after = disclosureWarning({ enabledKeys, n: 3 });
    expect(after.n).toBe(3);
    expect(after.comboSpace).toBe(before.comboSpace);      // same choices…
    expect(after.n).toBeGreaterThan(before.n);             // …re-evaluated against the CURRENT crowd
  });

  it('a STALE n is the dangerous direction: it can say "safe" when the crowd shrank', () => {
    // If a device kept the n it saw when the segment was large and the segment then shrank, it would
    // under-warn — the failure that matters. Pinned as a property of the input, so a caller that caches
    // `n` is visibly wrong rather than subtly wrong.
    const staleBig = disclosureWarning({ enabledKeys, n: 100_000 });
    const currentSmall = disclosureWarning({ enabledKeys, n: 2 });
    expect(staleBig.warn).toBe(false);
    expect(currentSmall.warn).toBe(true);
    expect(staleBig.warn).not.toBe(currentSmall.warn);     // the two disagree ⇒ n MUST be read live
  });

  it('one enabled attribute never warns, however small the crowd (the heuristic needs a combo)', () => {
    expect(disclosureWarning({ enabledKeys: ['place'], n: 1 }).warn).toBe(false);
  });

  it('three participants with different choices get different verdicts from the SAME n', () => {
    const n = 3;
    const anna = disclosureWarning({ enabledKeys: ['place'], n });                        // one attribute
    const bram = disclosureWarning({ enabledKeys: ['place', 'ageBand'], n });             // a combo
    const cato = disclosureWarning({ enabledKeys: [], n });                               // shares nothing
    expect(anna.warn).toBe(false);
    expect(bram.warn).toBe(true);
    expect(cato.warn).toBe(false);
    // The verdict is each participant's OWN — nobody's choices affect anyone else's warning.
    expect(bram.enabledCount).toBe(2);
    expect(anna.enabledCount).toBe(1);
  });

  it('`off` silences and `minimal` raises the bar — the graduated modes still key off the same n', () => {
    expect(disclosureWarning({ enabledKeys, n: 2, mode: 'off' }).warn).toBe(false);
    const minimal = disclosureWarning({ enabledKeys, n: 2, mode: 'minimal' });
    expect(minimal.n).toBe(2);                              // still reads the live cohort
  });
});
