import { describe, it, expect, vi } from 'vitest';
import { createActionFrequencyStore } from '../../src/v2/actionFrequency.js';

describe('actionFrequency · createActionFrequencyStore (D1 / §5A)', () => {
  it('starts empty', () => {
    const s = createActionFrequencyStore();
    expect(s.counts('c1')).toEqual({});
    expect(s.top('c1')).toEqual([]);
    expect(s.snapshot()).toEqual({});
  });

  it('bumps + accumulates per (circle, action)', () => {
    const s = createActionFrequencyStore();
    s.bump('c1', 'tasks');
    s.bump('c1', 'tasks');
    s.bump('c1', 'chat', 3);
    expect(s.counts('c1')).toEqual({ tasks: 2, chat: 3 });
  });

  it('keeps circles isolated', () => {
    const s = createActionFrequencyStore();
    s.bump('c1', 'tasks');
    s.bump('c2', 'chat');
    expect(s.counts('c1')).toEqual({ tasks: 1 });
    expect(s.counts('c2')).toEqual({ chat: 1 });
  });

  it('top() returns highest-count keys, count desc then key asc', () => {
    const s = createActionFrequencyStore();
    s.bump('c1', 'chat', 5);
    s.bump('c1', 'tasks', 5);   // tie with chat → alpha: chat before tasks
    s.bump('c1', 'notes', 2);
    s.bump('c1', 'calendar', 9);
    expect(s.top('c1', 4)).toEqual(['calendar', 'chat', 'tasks', 'notes']);
    expect(s.top('c1', 2)).toEqual(['calendar', 'chat']);
  });

  it('top() defaults to 4 and clamps junk n', () => {
    const s = createActionFrequencyStore();
    for (const k of ['a', 'b', 'c', 'd', 'e', 'f']) s.bump('c1', k);
    expect(s.top('c1')).toHaveLength(4);
    expect(s.top('c1', 0)).toHaveLength(4);     // 0 → default 4
    expect(s.top('c1', 'x')).toHaveLength(4);   // junk → default 4
  });

  it('ignores invalid bump input', () => {
    const s = createActionFrequencyStore();
    s.bump('', 'tasks');
    s.bump('c1', '');
    s.bump('c1', 'tasks', 0);
    s.bump('c1', 'tasks', -3);
    s.bump(null, null);
    expect(s.snapshot()).toEqual({});
  });

  it('hydrates from an initial snapshot, dropping malformed entries', () => {
    const s = createActionFrequencyStore({
      c1: { tasks: 3, chat: 1 },
      c2: { bad: 0, neg: -2, good: 4 },   // bad/neg dropped
      c3: 'nope',                         // non-object dropped
    });
    expect(s.counts('c1')).toEqual({ tasks: 3, chat: 1 });
    expect(s.counts('c2')).toEqual({ good: 4 });
    expect(s.counts('c3')).toEqual({});
  });

  it('round-trips snapshot → new store', () => {
    const a = createActionFrequencyStore();
    a.bump('c1', 'tasks', 2);
    a.bump('c1', 'chat');
    const b = createActionFrequencyStore(a.snapshot());
    expect(b.counts('c1')).toEqual({ tasks: 2, chat: 1 });
  });

  it('fires onChange + subscribers on mutation with the snapshot', () => {
    const onChange = vi.fn();
    const s = createActionFrequencyStore({}, { onChange });
    const sub = vi.fn();
    const off = s.subscribe(sub);
    s.bump('c1', 'tasks');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ c1: { tasks: 1 } });
    expect(sub).toHaveBeenCalledWith({ c1: { tasks: 1 } });
    off();
    s.bump('c1', 'chat');
    expect(sub).toHaveBeenCalledTimes(1); // unsubscribed
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('survives a throwing onChange / subscriber', () => {
    const s = createActionFrequencyStore({}, { onChange: () => { throw new Error('disk full'); } });
    s.subscribe(() => { throw new Error('boom'); });
    expect(() => s.bump('c1', 'tasks')).not.toThrow();
    expect(s.counts('c1')).toEqual({ tasks: 1 });
  });
});

describe('what this device counted, shown and cleared (My data)', () => {
  it('clear() forgets every count and tells the host to persist the empty snapshot', async () => {
    const { createActionFrequencyStore } = await import('../../src/v2/actionFrequency.js');
    const saved = [];
    const s = createActionFrequencyStore({ c1: { tasks: 3 } }, { onChange: (snap) => saved.push(snap) });
    s.clear();
    expect(s.snapshot()).toEqual({});
    expect(saved.at(-1)).toEqual({});
  });
  it("the rows My data shows: per circle, its features by count, in the circle's name", async () => {
    const { usageRows } = await import('../../src/v2/actionFrequency.js');
    const t = (k) => ({ 'circle.tabs.tasks': 'Tasks', 'circle.tabs.conversation': 'Messages' }[k] ?? k);
    expect(usageRows({ c1: { tasks: 3, chat: 12 }, gone: { tasks: 1 } }, { names: { c1: 'Straat' }, t }))
      .toEqual([{ circleId: 'c1', name: 'Straat', items: [{ key: 'chat', label: 'Messages', count: 12 }, { key: 'tasks', label: 'Tasks', count: 3 }] }]);
  });
});
