/**
 * A circle left on a device that is not the person's main device stays in the list until the main device's signed
 * leave lands back. Until then its tile is MARKED (never untouched), and the mark goes when the circle does.
 */
import { describe, it, expect } from 'vitest';
import { withLeavingMarks } from '../src/v2/circleModel.js';

describe('withLeavingMarks', () => {
  it('marks a circle being left, forwarded or held', () => {
    const leaving = new Map([['a', { held: false }], ['b', { held: true }]]);
    const out = withLeavingMarks([{ id: 'a' }, { id: 'b' }, { id: 'c' }], leaving);
    expect(out).toEqual([{ id: 'a', leaving: { held: false } }, { id: 'b', leaving: { held: true } }, { id: 'c' }]);
  });
  it('a circle no longer in the list: its leave landed — the mark is dropped', () => {
    const leaving = new Map([['a', { held: false }]]);
    expect(withLeavingMarks([{ id: 'c' }], leaving)).toEqual([{ id: 'c' }]);
    expect(leaving.size).toBe(0);
  });
  it('nothing being left: the list as given', () => {
    const list = [{ id: 'a' }];
    expect(withLeavingMarks(list, new Map())).toBe(list);
  });
});
