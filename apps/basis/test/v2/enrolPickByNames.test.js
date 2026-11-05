/**
 * The box's enrol picks personas by NAME (a command line has no checkboxes): `--persona Werk` (repeatable), `--no-general`.
 * The shells' picker model decides the rest — a device holds at least one self; the general persona comes unless left out.
 */
import { describe, it, expect } from 'vitest';
import { pickByNames, enrolPickArgs } from '../../src/v2/enrollOffer.js';

const listed = [{ id: 'p-aaaaaaaaaaaa', name: 'Werk', circles: [] }, { id: 'p-bbbbbbbbbbbb', name: 'Feedback', circles: [] }];

describe('pickByNames', () => {
  it('names (any case) or ids pick personas; the general persona comes too unless left out', () => {
    const r = pickByNames(listed, ['werk', 'p-bbbbbbbbbbbb']);
    expect(r.unknown).toEqual([]);
    expect(enrolPickArgs(r.state)).toEqual({ personas: ['p-aaaaaaaaaaaa', 'p-bbbbbbbbbbbb'], withDefault: true });
    expect(enrolPickArgs(pickByNames(listed, ['Feedback'], { withDefault: false }).state)).toEqual({ personas: ['p-bbbbbbbbbbbb'], withDefault: false });
  });
  it('an unknown name is reported, never guessed', () => {
    expect(pickByNames(listed, ['Prive']).unknown).toEqual(['Prive']);
  });
  it('leaving the general persona out with no persona picked is refused: a device holds at least one self', () => {
    expect(pickByNames(listed, [], { withDefault: false }).refused).toBe('last-self');
  });
  it('nothing asked: the general persona only, as before', () => {
    expect(enrolPickArgs(pickByNames(listed, []).state)).toEqual({ personas: [], withDefault: true });
  });
});
