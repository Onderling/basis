/**
 * THE ONBOARDING STRIP on Vandaag: three cards that go as each is done, never a modal — (1) your handle, until one is
 * set; (2) "Nieuw bij Basis?", until seen on this device (never for a returning person: a handle AND a circle);
 * (3) "Begin", until you are in a circle (the help circle does not count). A restored device with a handle and its
 * circles shows nothing.
 */
import { describe, it, expect } from 'vitest';
import { onboardingCards, materializeOnboarding, handleOp } from '../../src/v2/onboardingStrip.js';
import { HELP_CIRCLE_ID } from '../../src/v2/helpCircle.js';

describe('onboardingCards', () => {
  it('a new person: all three', () => {
    expect(onboardingCards({ handle: null, inCircle: false, introSeen: false }).map((c) => c.id)).toEqual(['handle', 'intro', 'begin']);
  });
  it('each goes as it is done', () => {
    expect(onboardingCards({ handle: 'anna', inCircle: false, introSeen: false }).map((c) => c.id)).toEqual(['intro', 'begin']);
    expect(onboardingCards({ handle: 'anna', inCircle: false, introSeen: true }).map((c) => c.id)).toEqual(['begin']);
    expect(onboardingCards({ handle: null, inCircle: true, introSeen: true }).map((c) => c.id)).toEqual(['handle']);
  });
  it('a returning person (a restored device: a handle and a circle) sees nothing', () => {
    expect(onboardingCards({ handle: 'anna', inCircle: true, introSeen: false })).toEqual([]);
  });
});

describe('materializeOnboarding', () => {
  it('reads the handle from the profile and the circles without the help circle; empty when nothing is left', async () => {
    const callSkill = async (app, op) => (app === 'pinboard' && op === 'getMyProfile' ? { entry: { handle: null } } : null);
    const b = await materializeOnboarding({ id: 'o', type: 'onboarding' }, { callSkill, circles: [{ id: HELP_CIRCLE_ID }], introSeen: async () => true });
    expect(b.content.cards.map((c) => c.id)).toEqual(['handle', 'begin']);
    const done = await materializeOnboarding({ id: 'o' }, { callSkill: async () => ({ entry: { handle: 'anna' } }), circles: [{ id: 'kring' }], introSeen: async () => true });
    expect(done.status).toBe('empty');
  });
});

describe('handleOp', () => {
  it('the handle goes through the profile op (the one the identity line reads), trimmed; empty is refused', () => {
    expect(handleOp('  anna ')).toEqual({ app: 'pinboard', opId: 'setMyHandle', args: { handle: 'anna' } });
    expect(handleOp('  ')).toEqual({ error: 'circle.vandaag.onboarding_handle_empty' });
  });
});
