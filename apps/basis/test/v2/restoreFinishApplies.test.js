/**
 * THE RESTORE-FINISH FLOW IS FOR A RESTORE, NOT FOR AN ADD (found 2026-09-24 by the own-devices browser walk).
 *
 * Every phrase ceremony leaves a `restore-pending` note — the add-a-device enrol included — and the next boot opened
 * the restore-finish flow on it. On a second device enrolled FROM AN OFFER that flow said "Je bent weer jezelf. Je
 * kringen zijn hier niet." before the offer had been consumed, and asked whether anyone could still use "the old
 * phone" — the phone that had just handed over the offer. A person adding a laptop was told their circles were gone.
 * An offer waiting at boot means the ceremony was an ADD: the offer brings the circles, and the flow does not apply.
 */
import { describe, it, expect } from 'vitest';
import { restoreFinishApplies } from '../../src/v2/enrollOffer.js';

describe('restoreFinishApplies', () => {
  it('a restore (the phrase on a new device, no offer): the flow asks what came back', () => {
    expect(restoreFinishApplies({ restorePending: true, offerPending: false })).toBe(true);
  });
  it('an add-a-device enrol from an offer: not a restore — the offer brings the circles', () => {
    expect(restoreFinishApplies({ restorePending: true, offerPending: true })).toBe(false);
  });
  it('no ceremony: nothing to finish', () => {
    expect(restoreFinishApplies({ restorePending: false, offerPending: false })).toBe(false);
  });
});
