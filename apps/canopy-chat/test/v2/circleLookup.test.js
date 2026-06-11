import { describe, it, expect, vi } from 'vitest';
import { makeCircleLookup } from '../../src/v2/circleLookup.js';

describe('makeCircleLookup', () => {
  it('returns the base candidates (normalized {id,label}) when there is no live fetch', async () => {
    const lookup = makeCircleLookup({ getBase: () => [{ id: 'a', title: 'Wash up' }, { id: 'b', text: 'Bins' }] });
    expect(await lookup('listOpen', 'wash', { id: 'c1' }, 'tasks-v0')).toEqual([
      { id: 'a', label: 'Wash up' }, { id: 'b', label: 'Bins' },
    ]);
  });

  it('app-qualifies the live fetch (calls appCallSkill with the op, scoped) and merges + dedups by id', async () => {
    const calls = [];
    const appCallSkill = vi.fn(async (app, op, args) => { calls.push([app, op, args]); return { tasks: [{ id: 'b', title: 'Bins' }, { id: 'c', title: 'Cook' }] }; });
    const lookup = makeCircleLookup({ getBase: () => [{ id: 'a', label: 'Wash' }, { id: 'b', label: 'Bins(base)' }], appCallSkill });
    const out = await lookup('listOpen', 'cook', { id: 'c1' }, 'tasks-v0');
    expect(calls[0]).toEqual(['tasks-v0', 'listOpen', { crewId: 'c1', circleId: 'c1', groupId: 'c1' }]);
    expect(out.map((c) => c.id)).toEqual(['a', 'b', 'c']);          // 'b' from base wins; 'c' added live
    expect(out.find((c) => c.id === 'b').label).toBe('Bins(base)'); // base not overwritten by the live dup
  });

  it('scopeId() overrides the scope id used for the fetch (web pins it to the active circle)', async () => {
    const appCallSkill = vi.fn(async () => []);
    const lookup = makeCircleLookup({ appCallSkill, scopeId: () => 'active-circle' });
    await lookup('listOpen', 'x', { id: 'thread-9' }, 'tasks-v0');   // scope.id is the thread, NOT the circle
    expect(appCallSkill).toHaveBeenCalledWith('tasks-v0', 'listOpen', { crewId: 'active-circle', circleId: 'active-circle', groupId: 'active-circle' });
  });

  it('a live-fetch throw keeps the base (best-effort degrade)', async () => {
    const lookup = makeCircleLookup({ getBase: () => [{ id: 'a', label: 'Wash' }], appCallSkill: async () => { throw new Error('offline'); } });
    expect(await lookup('listOpen', 'wash', { id: 'c1' }, 'tasks-v0')).toEqual([{ id: 'a', label: 'Wash' }]);
  });

  it('no app (or no appCallSkill) → base only, no fetch attempted', async () => {
    const appCallSkill = vi.fn(async () => [{ id: 'z', label: 'Z' }]);
    const lookup = makeCircleLookup({ getBase: () => [{ id: 'a', label: 'A' }], appCallSkill });
    expect(await lookup('listOpen', 'a', { id: 'c1' } /* no app */)).toEqual([{ id: 'a', label: 'A' }]);
    expect(appCallSkill).not.toHaveBeenCalled();
  });
});
