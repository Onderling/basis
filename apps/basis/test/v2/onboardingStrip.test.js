/**
 * THE ONBOARDING STRIP on Vandaag: three cards that go as each is done, never a modal — (1) your handle, until one is
 * set; (2) "Nieuw bij Basis?", until seen on this device (never for a returning person: a handle AND a circle);
 * (3) "Begin", until you are in a circle (the help circle does not count). A restored device with a handle and its
 * circles shows nothing.
 */
import { describe, it, expect } from 'vitest';
import { onboardingCards, materializeOnboarding, saveNameCard, nameCardWords, onboardingStripLine } from '../../src/v2/onboardingStrip.js';
import { HELP_CIRCLE_ID } from '../../src/v2/helpCircle.js';

describe('onboardingCards', () => {
  it('a new person: all three', () => {
    expect(onboardingCards({ handle: null, inCircle: false, introSeen: false }).map((c) => c.id)).toEqual(['handle', 'intro']);
  });
  it('each goes as it is done', () => {
    expect(onboardingCards({ handle: 'anna', inCircle: false, introSeen: false }).map((c) => c.id)).toEqual(['intro']);
    expect(onboardingCards({ handle: 'anna', inCircle: false, introSeen: true }).map((c) => c.id)).toEqual([]);
    expect(onboardingCards({ handle: null, inCircle: true, introSeen: true }).map((c) => c.id)).toEqual(['handle']);
  });
  it('a returning person (a restored device: a handle and a circle) sees nothing', () => {
    expect(onboardingCards({ handle: 'anna', inCircle: true, introSeen: false })).toEqual([]);
  });
});

describe('materializeOnboarding', () => {
  it('while the host does not know the circles yet (a cold start), the strip says nothing, never "not in a circle yet" (L1051)', async () => {
    const callSkill = async () => ({ entry: { handle: null } });
    const early = await materializeOnboarding({ id: 'o' }, { callSkill, circles: [], introSeen: async () => false, circlesKnown: () => false });
    expect(early.status).toBe('empty');
    expect(early.content?.noCircle ?? false).toBe(false);
    expect(early.content?.cards ?? []).toEqual([]);
    const known = await materializeOnboarding({ id: 'o' }, { callSkill, circles: [], introSeen: async () => false, circlesKnown: () => true });
    expect(known.content.noCircle).toBe(true);
    // a host that does not pass it (the web: it paints after its circles are read) is as before
    expect((await materializeOnboarding({ id: 'o' }, { callSkill, circles: [], introSeen: async () => false })).content.noCircle).toBe(true);
  });

  it('reads the handle from the profile and the circles without the help circle; empty when nothing is left', async () => {
    const callSkill = async (app, op) => (app === 'pinboard' && op === 'getMyProfile' ? { entry: { handle: null } } : null);
    const b = await materializeOnboarding({ id: 'o', type: 'onboarding' }, { callSkill, circles: [{ id: HELP_CIRCLE_ID }], introSeen: async () => true });
    expect(b.content.cards.map((c) => c.id)).toEqual(['handle']);
    expect(b.content.noCircle, 'the help circle does not count').toBe(true);
    const done = await materializeOnboarding({ id: 'o' }, { callSkill: async () => ({ entry: { handle: 'anna' } }), circles: [{ id: 'kring' }], introSeen: async () => true });
    expect(done.status).toBe('empty');
    expect(done.content.noCircle).toBe(false);
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

// Today folds the set-up cards into ONE closed strip (Frits, 2026-11-17): its line counts what is left; the begin card
// is gone (both doors are on Circles), and a person in no circle reads one line that points there.
describe('the folded strip', () => {
  const t = (k, v) => (v ? `${k}|${JSON.stringify(v)}` : k);
  it('counts the cards left, one and many', () => {
    expect(onboardingStripLine(1, t)).toBe('circle.vandaag.onboarding_strip_single');
    expect(onboardingStripLine(3, t)).toBe('circle.vandaag.onboarding_strip_many|{"count":3}');
  });
  it('a person with every card done but in no circle still gets the block, with the no-circle line', async () => {
    const b = await materializeOnboarding({ id: 'o' }, { callSkill: async () => ({ entry: { handle: 'anna' } }), circles: [], introSeen: async () => true });
    expect(b.content.cards).toEqual([]);
    expect(b.content.noCircle).toBe(true);
    expect(b.status).toBe('ok');
  });
});
