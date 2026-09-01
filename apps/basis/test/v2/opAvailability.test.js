/**
 * "May this op happen in this circle, for this person, right now?" — asked once, instead of by whoever
 * remembered which gate existed.
 *
 * The behaviour that matters is not the happy path; it is that a surface which asks THIS can no longer
 * offer something dispatch will refuse, and that the refusal carries a REASON, so the app can say "that
 * isn't switched on here" instead of "I couldn't turn that into an action".
 */
import { describe, it, expect } from 'vitest';
import { makeOpAvailability, UNAVAILABLE } from '../../src/v2/opAvailability.js';

const manifestsByOrigin = {
  basis: { app: 'basis', operations: [
    { id: 'embed',      verb: 'add' },
    { id: 'embed-time', verb: 'add' },
    { id: 'houseOnly',  verb: 'add', requires: ['houseRules'] },
  ] },
  tasks: { app: 'tasks', operations: [{ id: 'addTask', verb: 'add' }] },
};
const catalogueWith = (...ids) => ({ opsById: new Map(ids.map((id) => [id, {}])) });

describe('opAvailability', () => {
  it('says available when every gate is happy', () => {
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('embed') });
    expect(a.of('embed')).toEqual({ state: 'available', reason: null });
  });

  it('AN APP the circle does not compose is hidden, with a reason', () => {
    // The menu offered an op while the catalogue could not resolve it, so the tap threw and the person
    // was told the app did not understand them.
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('embed') });
    expect(a.of('addTask')).toEqual({ state: 'hidden', reason: UNAVAILABLE.NOT_COMPOSED });
  });

  it('…but THE DEVICE is not an app the circle composes — basis ops answer here regardless', () => {
    // The circle catalogue deliberately excludes basis, so the bot's language model cannot pick `/me`
    // out of a hundred ops. Asking composition of a DEVICE op read that scope as an answer to a
    // question it was never asked: the + menu's card and appointment came back "not in this circle",
    // the menu was left with nothing usable, and it rendered nothing at all.
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('addTask') });
    expect(a.of('embed')).toEqual({ state: 'available', reason: null });
    expect(a.of('embed-time')).toEqual({ state: 'available', reason: null });
  });

  it('a device op is still refusable — the feature gate applies to it as to anything else', () => {
    // Exempt from COMPOSITION, not from the rest: `houseOnly` is a basis op behind a circle feature,
    // and a circle with that feature off must not offer it. (The capability gate is exercised by the
    // matrix cases below, which cover both origins.)
    const off = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('addTask'),
      policy: { features: { houseRules: false } },
    });
    expect(off.of('houseOnly').reason).toBe(UNAVAILABLE.FEATURE_OFF);
  });

  it('gives the app a sentence to say instead of a shrug', () => {
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('embed') });
    expect(a.keyFor('addTask')).toBe('circle.op.not_in_this_circle');
    expect(a.keyFor('addTask'), 'never the generic "I did not understand"').not.toBe('circle.bot.unknown');
  });

  it('hides an op whose feature the circle has switched off', () => {
    const a = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('houseOnly'),
      policy: { features: { houseRules: false } },
    });
    expect(a.of('houseOnly').reason).toBe(UNAVAILABLE.FEATURE_OFF);
  });

  it('…and allows it when the feature is on', () => {
    const a = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('houseOnly'),
      policy: { features: { houseRules: true } },
    });
    expect(a.of('houseOnly').state).toBe('available');
  });

  it('greys where the capability matrix greys, hides where it hides', () => {
    // The row shape is the freedom matrix's own — `{app, atom, noun, enabled, optedOut, consequence}`.
    // These cases used to pass a hand-shaped `{treatment}` row and then accept EITHER outcome
    // (`greyed || available`), which is a test agreeing with whatever happens: the row matched nothing,
    // every op read as allowed, and the gate was never exercised. Found by a journey that asserted the
    // refusal outright and went red. A capability gate that cannot fail its own test is not a gate.
    const withheld = (consequence) => [{
      app: 'basis', atom: 'add', noun: null, enabled: false, optedOut: false, consequence,
    }];
    const grey = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('embed'), capabilityMatrix: withheld('greyed'),
    });
    const hide = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('embed'), capabilityMatrix: withheld('hidden'),
    });
    expect(grey.of('embed')).toEqual({ state: 'greyed', reason: UNAVAILABLE.CAPABILITY });
    expect(hide.of('embed')).toEqual({ state: 'hidden', reason: UNAVAILABLE.CAPABILITY });
    // An AUTHORISED row is not a refusal — the gate only speaks when the capability is withheld.
    const ok = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('embed'),
      capabilityMatrix: [{ app: 'basis', atom: 'add', noun: null, enabled: true, optedOut: false, consequence: 'hidden' }],
    });
    expect(ok.of('embed').state).toBe('available');
  });

  it('an op no manifest declares is unknown — a typo must not read as "not switched on"', () => {
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('embed') });
    expect(a.of('nonesuch').reason).toBe(UNAVAILABLE.UNKNOWN);
    expect(a.of('').reason).toBe(UNAVAILABLE.UNKNOWN);
  });

  it('DENY-WINS: the first gate that refuses decides, and hidden beats greyed', () => {
    // Not composed AND not permitted → the structural refusal wins, because a person cannot fix their
    // capability to make an app appear. (An APP op — the device is exempt from this rung.)
    const a = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('embed'),
      capabilityMatrix: [{ app: 'tasks', atom: 'add', treatment: 'grey' }],
    });
    expect(a.of('addTask')).toEqual({ state: 'hidden', reason: UNAVAILABLE.NOT_COMPOSED });
  });

  it('makes no claim about composition when given no catalogue', () => {
    // Answering "yes" from silence is exactly how the attach menu came to offer dead entries.
    const a = makeOpAvailability({ manifestsByOrigin });
    expect(a.of('embed').state).toBe('available');
    expect(a.of('nonesuch').state, 'but an unknown op is still unknown').toBe('hidden');
  });
});
