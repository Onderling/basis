/**
 * The enrol picker, one model both shells paint: the general persona is a row like any persona (ticked by default),
 * the person may untick it when another self is ticked, never the LAST self (a device holds at least one), and the
 * picker says which self the device will speak as — the first ticked (the general persona when it is). What a save
 * hands the ceremony is `{ personas, withDefault }`.
 */
import { describe, it, expect } from 'vitest';
import { enrolPickState, togglePick, pickerRows, pickPrimary, enrolPickArgs } from '../../src/v2/enrollOffer.js';

const listed = [{ id: 'p-aaaaaaaaaaaa', name: 'Werk' }, { id: 'p-bbbbbbbbbbbb', name: 'Buurt' }];

describe('the enrol picker', () => {
  it('starts with the general persona ticked and no persona; the device speaks as the general persona', () => {
    const s = enrolPickState({});
    expect(pickerRows(listed, s).map((r) => [r.id, r.checked])).toEqual([['default', true], ['p-aaaaaaaaaaaa', false], ['p-bbbbbbbbbbbb', false]]);
    expect(pickerRows(listed, s)[0].nameKey).toBe('circle.switcher.you');
    expect(pickPrimary(s)).toBe('default');
    expect(enrolPickArgs(s)).toEqual({ personas: [], withDefault: true });
  });

  it('the general persona can be left off once another self is ticked; the first ticked persona is then the primary', () => {
    let s = togglePick(enrolPickState({}), 'p-aaaaaaaaaaaa').state;
    const off = togglePick(s, 'default');
    expect(off.refused).toBeUndefined();
    s = off.state;
    expect(pickPrimary(s)).toBe('p-aaaaaaaaaaaa');
    expect(enrolPickArgs(s)).toEqual({ personas: ['p-aaaaaaaaaaaa'], withDefault: false });
  });

  it('the last self cannot be unticked — refused, and nothing changes', () => {
    const s = enrolPickState({});
    const r = togglePick(s, 'default');
    expect(r.refused).toBe('last-self');
    expect(r.state).toEqual(s);
    const w = togglePick(togglePick(togglePick(s, 'p-aaaaaaaaaaaa').state, 'default').state, 'p-aaaaaaaaaaaa');
    expect(w.refused).toBe('last-self');
  });
});
