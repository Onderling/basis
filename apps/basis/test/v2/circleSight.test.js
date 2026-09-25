/**
 * A CIRCLE OUT OF SIGHT (opbergen, Frits 2026-09-24; Fable's shape): ONE fact with three values — shown · put away ·
 * not on this device. "Put away" is the person's mark, carried to every device; "not on this device" is the kring
 * opt-out (`syncSelection.kringOn`), the device's own value of the same fact. Both fold out of the launcher's list.
 */
import { describe, it, expect } from 'vitest';
import { circleSightOf, splitBySight, SIGHT } from '../../src/v2/circleSight.js';

describe('circleSightOf', () => {
  it('shown by default', () => { expect(circleSightOf('c', {})).toBe(SIGHT.shown); });
  it('put away when the mark says so', () => { expect(circleSightOf('c', { sights: { c: { putAway: true, at: 1 } } })).toBe(SIGHT.putAway); });
  it('taken out again is shown', () => { expect(circleSightOf('c', { sights: { c: { putAway: false, at: 2 } } })).toBe(SIGHT.shown); });
  it('not on this device when the kring is switched off here — the device value wins over the person\'s', () => {
    expect(circleSightOf('c', { sights: { c: { putAway: true, at: 1 } }, kringOn: () => false })).toBe(SIGHT.notHere);
  });
});

describe('splitBySight', () => {
  it('keeps the list order and folds away what is out of sight, each with its value', () => {
    const circles = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const r = splitBySight(circles, { sights: { b: { putAway: true, at: 1 } }, kringOn: (id) => id !== 'c' });
    expect(r.shown.map((c) => c.id)).toEqual(['a']);
    expect(r.folded.map((c) => [c.id, c.sight])).toEqual([['b', SIGHT.putAway], ['c', SIGHT.notHere]]);
  });
});
