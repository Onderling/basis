/**
 * A persona's offerings do not follow the general persona when it says so: a new persona is asked "what you offer —
 * also as <name>?" (default no), and the answer is kept on the persona as its own marker. With the marker off, the
 * general persona's OFFERING drivers do not reach it — its own offerings do, and every other kind still inherits.
 */
import { describe, it, expect } from 'vitest';
import { effectiveDrivers, OFFERINGS_INHERIT_KEY } from '../index.js';

const own = (value) => ({ mode: 'own', value });
const general = {
  agentId: 'default',
  properties: {
    tuin: own({ kind: 'offering', text: 'Tuinieren', tags: ['tuin'] }),
    muziek: own({ kind: 'interest', text: 'Muziek', tags: ['muziek'] }),
  },
};
const persona = (props) => ({ agentId: 'p-werk', properties: props });
const lookup = (p) => (id) => (id === 'default' ? general : id === 'p-werk' ? p : null);

describe('a persona\'s offerings, inherited or not', () => {
  it('no marker (a persona from before): everything inherits, offerings too', () => {
    const p = persona({});
    expect(Object.keys(effectiveDrivers(lookup(p), 'p-werk', { defaultProfileId: 'default' })).sort()).toEqual(['muziek', 'tuin']);
  });
  it('the marker off: the general offering stays away, its own offering and other kinds remain', () => {
    const p = persona({ [OFFERINGS_INHERIT_KEY]: own(false), fiets: own({ kind: 'offering', text: 'Fietsen', tags: ['fiets'] }) });
    expect(Object.keys(effectiveDrivers(lookup(p), 'p-werk', { defaultProfileId: 'default' })).sort()).toEqual(['fiets', 'muziek']);
  });
  it('the marker on: the general offering is the persona\'s too', () => {
    const p = persona({ [OFFERINGS_INHERIT_KEY]: own(true) });
    expect(Object.keys(effectiveDrivers(lookup(p), 'p-werk', { defaultProfileId: 'default' })).sort()).toEqual(['muziek', 'tuin']);
  });
  it('the general persona itself is never stopped', () => {
    expect(Object.keys(effectiveDrivers(lookup(persona({})), 'default', { defaultProfileId: 'default' })).sort()).toEqual(['muziek', 'tuin']);
  });
});
