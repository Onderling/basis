import { describe, it, expect, vi } from 'vitest';
import { clarifyCommandTargets } from '../../src/v2/clarifyTargets.js';

// markComplete takes an id-like `target` (pickerSource → listOpen); addTask takes a plain title.
const CATALOG = { opsById: new Map([
  ['markComplete', { op: { id: 'markComplete', params: [
    { name: 'target', kind: 'string', required: true, pickerSource: { listOp: 'listOpen' } } ] } }],
  ['addTask', { op: { id: 'addTask', params: [{ name: 'title', kind: 'string', required: true }] } }],
]) };

const lookupOf = (items) => vi.fn(async () => items);

describe('clarifyCommandTargets', () => {
  it('binds the id and returns ready on a UNIQUE match', async () => {
    const lookup = lookupOf([{ id: 'T1', label: 'wash the dishes' }, { id: 'T2', label: 'take out bins' }]);
    const r = await clarifyCommandTargets({ opId: 'markComplete', args: { target: 'dishes' } }, { catalog: CATALOG, lookup, scope: { id: 'circle-A' } });
    expect(r).toEqual({ kind: 'ready', opId: 'markComplete', args: { target: 'T1' } });
    expect(lookup).toHaveBeenCalledWith('listOpen', 'dishes', { id: 'circle-A' });
  });

  it('returns clarify with candidates on an AMBIGUOUS match', async () => {
    const lookup = lookupOf([{ id: 'T1', label: 'wash the dishes' }, { id: 'T3', label: 'dry the dishes' }]);
    const r = await clarifyCommandTargets({ opId: 'markComplete', args: { target: 'dishes' } }, { catalog: CATALOG, lookup });
    expect(r.kind).toBe('clarify');
    expect(r.param).toBe('target');
    expect(r.query).toBe('dishes');
    expect(r.candidates).toEqual([{ id: 'T1', label: 'wash the dishes' }, { id: 'T3', label: 'dry the dishes' }]);
    expect(r.args.target).toBe('dishes');   // left unbound until the user picks
  });

  it('returns unresolved when a required id-param matches NOTHING', async () => {
    const lookup = lookupOf([{ id: 'T2', label: 'take out bins' }]);
    const r = await clarifyCommandTargets({ opId: 'markComplete', args: { target: 'laundry' } }, { catalog: CATALOG, lookup });
    expect(r).toEqual({ kind: 'unresolved', opId: 'markComplete', args: { target: 'laundry' }, param: 'target', query: 'laundry' });
  });

  it('returns unresolved when a required id-param is missing entirely', async () => {
    const r = await clarifyCommandTargets({ opId: 'markComplete', args: {} }, { catalog: CATALOG, lookup: lookupOf([]) });
    expect(r).toEqual({ kind: 'unresolved', opId: 'markComplete', args: {}, param: 'target', query: '' });
  });

  it('passes through commands with no id-like params (ready, no lookup)', async () => {
    const lookup = vi.fn();
    const r = await clarifyCommandTargets({ opId: 'addTask', args: { title: 'milk' } }, { catalog: CATALOG, lookup });
    expect(r).toEqual({ kind: 'ready', opId: 'addTask', args: { title: 'milk' } });
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skips lookup when the value is already a concrete id', async () => {
    const lookup = vi.fn();
    const r = await clarifyCommandTargets({ opId: 'markComplete', args: { target: '01HXYZ1234567890ABCDEF' } }, { catalog: CATALOG, lookup });
    expect(r.kind).toBe('ready');
    expect(r.args.target).toBe('01HXYZ1234567890ABCDEF');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('carries an optional screen/source hint into the candidates', async () => {
    const lookup = lookupOf([
      { id: 'T1', label: 'dishes', hint: 'Kitchen screen' },
      { id: 'T9', label: 'dishes', hint: 'Chores screen' },
    ]);
    const r = await clarifyCommandTargets({ opId: 'markComplete', args: { target: 'dishes' } }, { catalog: CATALOG, lookup });
    expect(r.kind).toBe('clarify');
    expect(r.candidates).toEqual([
      { id: 'T1', label: 'dishes', hint: 'Kitchen screen' },
      { id: 'T9', label: 'dishes', hint: 'Chores screen' },
    ]);
  });
});
