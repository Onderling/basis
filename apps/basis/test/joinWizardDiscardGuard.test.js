/**
 * Dismissing a half-filled join asks first — and the question is decided in ONE place.
 *
 * Found by driving the wizard on a phone (2026-08-31): the hardware back button and a tap outside the
 * sheet both went straight to `onClose`, so a join that had read the rules, acknowledged the privacy
 * notice and typed a handle vanished with nothing to return to. It happened three times in one sitting,
 * twice mid-typing, and read as a dead tap rather than a dismissal. Web had the same hole through its
 * click-outside overlay.
 *
 * `isJoinDirty` is shared because both shells ask it: the same loss should not be judged two ways.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { initialState, isJoinDirty } from '../src/core/wizards/joinGroupState.js';

describe('isJoinDirty — what counts as something to lose', () => {
  it('a freshly opened wizard is NOT dirty (opening an invite and backing out costs no dialog)', () => {
    expect(isJoinDirty(initialState())).toBe(false);
  });

  it('is not fooled by a missing or malformed state', () => {
    expect(isJoinDirty(null)).toBe(false);
    expect(isJoinDirty(undefined)).toBe(false);
    expect(isJoinDirty('nope')).toBe(false);
  });

  for (const [what, patch] of [
    ['past the first step',        { step: 2 }],
    ['the rules were accepted',    { rulesAccepted: true }],
    ['the privacy notice was read', { privacyAccepted: true }],
    ['a handle was typed',         { handle: 'anna' }],
    ['a persona was chosen',       { persona: 'default' }],
    ['a capability was declined',  { capabilityOptOuts: ['prikbord'] }],
    ['address sharing was turned OFF (a choice, though it leaves no text)', { shareAddress: false }],
    ['the join is in flight',      { submitting: true }],
  ]) {
    it(`is dirty once ${what}`, () => {
      expect(isJoinDirty({ ...initialState(), ...patch })).toBe(true);
    });
  }

  it('whitespace in the handle field is not an answer', () => {
    expect(isJoinDirty({ ...initialState(), handle: '   ' })).toBe(false);
  });
});

describe('both shells route their ACCIDENTAL dismissals through the guard', () => {
  // Static, on purpose: the RN modal cannot be rendered here (no RN runtime) and the web wizard's
  // overlay lives in the shell. What matters is that neither accidental path calls `onClose` directly
  // any more — which is precisely what the source says.
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('the phone: hardware back and the backdrop ask, the explicit Cancel does not', () => {
    const rn = read('../src/rn/wizards/joinGroupWizardModal.js');
    expect(rn).toMatch(/onRequestClose=\{requestClose\}/);
    expect(rn).toMatch(/style=\{styles\.backdrop\}\s+onPress=\{requestClose\}/);
    expect(rn).toContain('isJoinDirty(state)');
    // Cancel stays a direct close: the person said so.
    expect(rn).toMatch(/circle\.join\.wizard\.cancel'\), onPress: onClose/);
  });

  it('the browser: the wizard registers a close guard for the click-outside', () => {
    const web = read('../src/web/wizards/joinGroupWizard.js');
    expect(web).toContain('setCloseGuard?.(');
    expect(web).toContain('isJoinDirty(state)');
  });

  it('…and the host consults it before removing the overlay', () => {
    const host = read('../web/v2/circleApp.js');
    expect(host).toContain('setCloseGuard:');
    expect(host).toMatch(/closeGuard\(\) !== true\) return;/);
  });
});
