import { describe, it, expect } from 'vitest';
import { opCollisions, opOwnerProblems } from './lint-op-owners.mjs';

const m = (id, ...ops) => ({ id, operations: ops.map((o) => ({ id: o })) });

describe('lint-op-owners', () => {
  it('finds the op ids more than one manifest declares', () => {
    expect(opCollisions([m('a', 'x', 'y'), m('b', 'y', 'z'), m('c', 'y')])).toEqual({ y: ['a', 'b', 'c'] });
  });
  it('is quiet on the baseline', () => {
    expect(opOwnerProblems({ y: ['a', 'b'] }, { y: ['a', 'b'] })).toEqual([]);
  });
  it('is red for a new shared op and for a new owner of a known one', () => {
    expect(opOwnerProblems({ q: ['a', 'b'] }, {}).join('\n')).toMatch(/NEW op declared by more than one manifest: q/);
    expect(opOwnerProblems({ y: ['a', 'b', 'c'] }, { y: ['a', 'b'] }).join('\n')).toMatch(/y gained an owner: c/);
  });
  it('is red until the baseline shrinks with the code', () => {
    expect(opOwnerProblems({}, { y: ['a', 'b'] }).join('\n')).toMatch(/shrink OP_OWNER_BASELINE/);
  });
});
