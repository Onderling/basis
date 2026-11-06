/**
 * THE ONBOARDING STRIP on Vandaag: three cards that go as each is done, never a modal — (1) your handle, until one is
 * set; (2) "Nieuw bij Basis?", until seen on this device (never for a returning person: a handle AND a circle);
 * (3) "Begin", until you are in a circle (the help circle does not count). A restored device with a handle and its
 * circles shows nothing.
 */
import { describe, it, expect } from 'vitest';
import { onboardingCards, materializeOnboarding, saveNameCard, nameCardWords } from '../../src/v2/onboardingStrip.js';
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

// The walk (2026-11-05): "Tester B" typed into "Zo heet je hier" was sent AS the handle, refused (a space, capitals),
// dropped by both shells, and the card came back empty. The name is the display name; the handle is made from it.
describe('the name card', () => {
  it('carries the name already on the profile, so the card shows what the avatar letters come from', async () => {
    const b = await materializeOnboarding({ id: 'o' }, { callSkill: async () => ({ entry: { displayName: 'Tester B' } }), circles: [] });
    expect(b.content.cards.find((c) => c.id === 'handle')?.name).toBe('Tester B');
  });
  const host = ({ taken = [] } = {}) => {
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push([op, args]);
      if (op === 'setMyHandle' && taken.includes(args.handle)) return { error: 'invalid-handle', reason: 'handle-taken' };
      return { ok: true };
    };
    return { calls, callSkill };
  };
  const t = (k, v = {}) => (k === 'circle.vandaag.onboarding_handle_saved' ? `Opgeslagen — je heet hier ${v.name}` : k);

  it('"Tester B" becomes the display name, and the handle is made from it', async () => {
    const h = host();
    const r = await saveNameCard('  Tester B ', h);
    expect(r).toEqual({ ok: true, name: 'Tester B', handle: 'tester-b' });
    expect(h.calls).toEqual([['setMyDisplayName', { displayName: 'Tester B' }], ['setMyHandle', { handle: 'tester-b' }]]);
    expect(nameCardWords(r, t)).toBe('Opgeslagen — je heet hier Tester B');
  });
  it('a taken handle gets a number, silently — never a refusal the person has to understand', async () => {
    const r = await saveNameCard('Tester B', host({ taken: ['tester-b'] }));
    expect(r).toEqual({ ok: true, name: 'Tester B', handle: 'tester-b2' });
  });
  it('nothing typed, or nothing a name can be made of, says why', async () => {
    expect(await saveNameCard('  ', host())).toEqual({ ok: false, error: 'circle.vandaag.onboarding_handle_empty' });
    expect(await saveNameCard('!!!', host())).toEqual({ ok: false, error: 'circle.vandaag.onboarding_handle_unusable' });
  });
});
