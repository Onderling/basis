// Disclosure profile: default-withhold, opt-in per attribute, coarse-only, no leak markers.
import { describe, it, expect } from 'vitest';
import { createCharter } from '../src/charter.js';
import {
  createDisclosureProfile, setValue, setEnabled, enabledSharedKeys, releasedValues,
} from '../src/disclosureProfile.js';

const charter = createCharter({ projectId: 'circle-42', attributes: [
  { key: 'place', purpose: 'circles' },
  { key: 'ageBand', purpose: 'age spread' },
] });

describe('disclosure profile', () => {
  it('a fresh profile shares NOTHING (default withhold)', () => {
    let p = createDisclosureProfile({ projectId: 'circle-42' });
    p = setValue(p, 'place', 'Groningen');           // value set, but not enabled
    p = setValue(p, 'ageBand', '35-54');
    expect(releasedValues(p, charter)).toEqual({});  // absent, not marked
    expect(enabledSharedKeys(p, charter)).toEqual([]);
  });

  it('releases only enabled + valued keys the charter requests', () => {
    let p = createDisclosureProfile({ projectId: 'circle-42' });
    p = setEnabled(setValue(p, 'place', 'Groningen'), 'place', true);
    p = setValue(p, 'ageBand', '35-54');             // valued but NOT enabled → withheld
    expect(releasedValues(p, charter)).toEqual({ place: 'Groningen' });
  });

  it('never releases a key the charter does not request, even if enabled', () => {
    let p = createDisclosureProfile({ projectId: 'circle-42' });
    p = setEnabled(setValue(p, 'role', 'resident'), 'role', true);   // role not in this charter
    expect(releasedValues(p, charter)).toEqual({});
  });

  it('rejects fine / off-vocabulary values', () => {
    const p = createDisclosureProfile({ projectId: 'circle-42' });
    expect(() => setValue(p, 'ageBand', '37')).toThrow(/coarse allowed value/);   // exact age
    expect(() => setValue(p, 'place', '9712CP')).toThrow(/coarse allowed value/); // postcode
    expect(() => setValue(p, 'income', 'high')).toThrow(/unknown attribute key/);
  });

  it('is immutable per call (returns new objects)', () => {
    const p0 = createDisclosureProfile({ projectId: 'circle-42' });
    const p1 = setValue(p0, 'place', 'Groningen');
    expect(p0.values).toEqual({});          // original untouched
    expect(p1.values).toEqual({ place: 'Groningen' });
  });
});
