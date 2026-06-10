import { describe, it, expect, vi } from 'vitest';
import { createClarifyingDispatch } from '../../src/v2/clarifyingDispatch.js';

const CATALOG = { opsById: new Map([
  ['markComplete', { op: { id: 'markComplete', params: [
    { name: 'target', kind: 'string', required: true, pickerSource: { listOp: 'listOpen' } } ] } }],
]) };

function harness(items) {
  const dispatched = [];
  const asked = [];
  const missed = [];
  const cd = createClarifyingDispatch({
    catalog: () => CATALOG,
    lookup: async () => items,
    dispatchReady: (cmd) => { dispatched.push(cmd); },
    ask: (q) => { asked.push(q); },
    askMissing: (m) => { missed.push(m); },
  });
  return { cd, dispatched, asked, missed };
}

describe('createClarifyingDispatch', () => {
  it('dispatches directly on a unique match (no question)', async () => {
    const { cd, dispatched, asked } = harness([{ id: 'T1', label: 'wash the dishes' }, { id: 'T2', label: 'bins' }]);
    await cd.run({ opId: 'markComplete', args: { target: 'dishes' } }, { id: 'circle-A' });
    expect(dispatched).toEqual([{ opId: 'markComplete', args: { target: 'T1' } }]);
    expect(asked).toEqual([]);
  });

  it('asks on ambiguity, then dispatches the picked candidate', async () => {
    const { cd, dispatched, asked } = harness([{ id: 'T1', label: 'wash dishes' }, { id: 'T3', label: 'dry dishes' }]);
    const scope = { id: 'circle-A' };
    await cd.run({ opId: 'markComplete', args: { target: 'dishes' } }, scope);
    expect(dispatched).toEqual([]);                    // nothing dispatched yet — it asked
    expect(asked).toHaveLength(1);
    expect(asked[0].candidates.map((c) => c.id)).toEqual(['T1', 'T3']);
    expect(cd.hasPending(scope)).toBe(true);

    await cd.pick('T3', scope);                        // user picks the second
    expect(dispatched).toEqual([{ opId: 'markComplete', args: { target: 'T3' } }]);
    expect(cd.hasPending(scope)).toBe(false);
  });

  it('keeps pending state per-scope (a pick in one circle does not leak to another)', async () => {
    const { cd, dispatched } = harness([{ id: 'A', label: 'dishes one' }, { id: 'B', label: 'dishes two' }]);
    await cd.run({ opId: 'markComplete', args: { target: 'dishes' } }, { id: 'circle-A' });
    expect(cd.hasPending({ id: 'circle-A' })).toBe(true);
    await expect(cd.pick('A', { id: 'circle-B' })).resolves.toEqual({ kind: 'no-pending' });
    await cd.pick('A', { id: 'circle-A' });
    expect(dispatched).toEqual([{ opId: 'markComplete', args: { target: 'A' } }]);
  });

  it('calls askMissing when a required target is not found', async () => {
    const { cd, dispatched, asked, missed } = harness([{ id: 'T2', label: 'bins' }]);
    await cd.run({ opId: 'markComplete', args: { target: 'laundry' } }, { id: 'c' });
    expect(dispatched).toEqual([]);
    expect(asked).toEqual([]);
    expect(missed).toEqual([{ opId: 'markComplete', param: 'target', query: 'laundry' }]);
  });

  it('pick with no pending question is a no-op', async () => {
    const { cd, dispatched } = harness([]);
    expect(await cd.pick('whatever', { id: 'c' })).toEqual({ kind: 'no-pending' });
    expect(dispatched).toEqual([]);
  });

  it('requires dispatchReady + ask', () => {
    expect(() => createClarifyingDispatch({ ask: () => {} })).toThrow();
    expect(() => createClarifyingDispatch({ dispatchReady: () => {} })).toThrow();
  });
});
