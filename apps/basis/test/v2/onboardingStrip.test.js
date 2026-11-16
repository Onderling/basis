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
  const t = (k, v = {}) => (k === 'circle.vandaag.onboarding_handle_saved' ? `Opgeslagen. Je heet hier ${v.name}` : k);

  it('"Tester B" becomes the display name and the name in circles, both as typed', async () => {
    const h = host();
    const r = await saveNameCard('  Tester B ', h);
    expect(r).toEqual({ ok: true, name: 'Tester B', handle: 'Tester B' });
    expect(h.calls).toEqual([['setMyDisplayName', { displayName: 'Tester B' }], ['setMyHandle', { handle: 'Tester B' }]]);
    expect(nameCardWords(r, t)).toBe('Opgeslagen. Je heet hier Tester B');
  });
  it('a taken name gets a number, silently, never a refusal the person has to understand', async () => {
    const r = await saveNameCard('Tester B', host({ taken: ['Tester B'] }));
    expect(r).toEqual({ ok: true, name: 'Tester B', handle: 'Tester B 2' });
  });
  it('nothing typed, or nothing a name can be made of, says why', async () => {
    expect(await saveNameCard('  ', host())).toEqual({ ok: false, error: 'circle.vandaag.onboarding_handle_empty' });
    expect(await saveNameCard('a\u0007b', host())).toEqual({ ok: false, error: 'circle.vandaag.onboarding_handle_unusable' });
  });
});

// No connection point (walk rows 16/9/11): messages went into nothing with no word about it. With no relay known, Today
// says so, what works already, and opens the connection points; a host that cannot say shows no card rather than a false one.
describe('the reach card', () => {
  it('shows when this device knows no relay, and not when it knows one or cannot say', async () => {
    const m = (relayKnown) => materializeOnboarding({ id: 'o' }, { callSkill: async () => ({ entry: { handle: 'ann' } }), circles: [{ id: 'k' }], introSeen: async () => true, ...(relayKnown ? { relayKnown } : {}) });
    expect((await m(async () => false)).content.cards.map((c) => c.id)).toContain('reach');
    expect((await m(async () => true)).content.cards.map((c) => c.id)).not.toContain('reach');
    expect((await m(null)).content.cards.map((c) => c.id)).not.toContain('reach');
  });
});
