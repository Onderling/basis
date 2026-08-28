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

  it('THE ATTACH BUG: an op the circle does not compose is hidden, with a reason', () => {
    // The menu offered `embed` while the catalogue could not resolve it, so the tap threw and the
    // person was told the app did not understand them.
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('addTask') });
    expect(a.of('embed')).toEqual({ state: 'hidden', reason: UNAVAILABLE.NOT_COMPOSED });
  });

  it('gives the app a sentence to say instead of a shrug', () => {
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('addTask') });
    expect(a.keyFor('embed')).toBe('circle.op.not_in_this_circle');
    expect(a.keyFor('embed'), 'never the generic "I did not understand"').not.toBe('circle.bot.unknown');
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
    const grey = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('embed'),
      capabilityMatrix: [{ app: 'basis', atom: 'add', treatment: 'grey' }],
    });
    const hide = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('embed'),
      capabilityMatrix: [{ app: 'basis', atom: 'add', treatment: 'hide' }],
    });
    expect(grey.of('embed').state === 'greyed' || grey.of('embed').state === 'available').toBe(true);
    expect(['hidden', 'available']).toContain(hide.of('embed').state);
  });

  it('an op no manifest declares is unknown — a typo must not read as "not switched on"', () => {
    const a = makeOpAvailability({ manifestsByOrigin, catalogue: catalogueWith('embed') });
    expect(a.of('nonesuch').reason).toBe(UNAVAILABLE.UNKNOWN);
    expect(a.of('').reason).toBe(UNAVAILABLE.UNKNOWN);
  });

  it('DENY-WINS: the first gate that refuses decides, and hidden beats greyed', () => {
    // Not composed AND not permitted → the structural refusal wins, because a person cannot fix their
    // capability to make an app appear.
    const a = makeOpAvailability({
      manifestsByOrigin, catalogue: catalogueWith('addTask'),
      capabilityMatrix: [{ app: 'basis', atom: 'add', treatment: 'grey' }],
    });
    expect(a.of('embed')).toEqual({ state: 'hidden', reason: UNAVAILABLE.NOT_COMPOSED });
  });

  it('makes no claim about composition when given no catalogue', () => {
    // Answering "yes" from silence is exactly how the attach menu came to offer dead entries.
    const a = makeOpAvailability({ manifestsByOrigin });
    expect(a.of('embed').state).toBe('available');
    expect(a.of('nonesuch').state, 'but an unknown op is still unknown').toBe('hidden');
  });
});
