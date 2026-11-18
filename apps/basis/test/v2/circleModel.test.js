import { describe, it, expect } from 'vitest';
import {
  normalizeCircle,
  mergeCircles,
  loadCircles,
} from '../../src/v2/circleModel.js';

describe('circleModel · normalizeCircle', () => {
  it('normalises a circle (circleId ≡ circleId) with counts', () => {
    expect(normalizeCircle({ circleId: 'abc', name: 'Huis', counts: { members: 4 } }))
      .toMatchObject({ id: 'abc', name: 'Huis', memberCount: 4 });
  });

  it('counts a members array', () => {
    expect(normalizeCircle({ id: 'x', name: 'Selwerd', members: ['a', 'b', 'c'] }))
      .toMatchObject({ id: 'x', memberCount: 3 });
  });

  it('falls back name → id, and returns null without an id', () => {
    expect(normalizeCircle({ id: 'only-id' }).name).toBe('only-id');
    expect(normalizeCircle({ name: 'no id' })).toBeNull();
    expect(normalizeCircle({})).toBeNull();
  });
});

describe('circleModel · mergeCircles', () => {
  it('de-dupes by id (circleId ≡ circleId) and fills gaps from later sources', () => {
    const merged = mergeCircles(
      [{ circleId: 'g1', name: 'G1', counts: { members: 2 } }],
      [{ id: 'g1', name: 'G1', lastActivity: '2026-05-28T10:00:00Z' }],
      [{ id: 'g2', name: 'G2' }],
    );
    expect(merged).toHaveLength(2);
    const g1 = merged.find((c) => c.id === 'g1');
    expect(g1.memberCount).toBe(2);
    expect(g1.lastActivity).toBe('2026-05-28T10:00:00Z');
  });

  it('ignores non-array sources and id-less items', () => {
    expect(mergeCircles(null, undefined, [{ name: 'x' }, { id: 'ok' }]))
      // no name reached it: its name is its id, and it says so (`unnamed`)
      .toEqual([{ id: 'ok', name: 'ok', kind: null, memberCount: null, lastActivity: null, features: null, unnamed: true }]);
  });
});

describe('circleModel · loadCircles', () => {
  it('aggregates fetchers and tolerates a failing source', async () => {
    const list = await loadCircles({
      fetchTasksCircles: async () => [{ circleId: 'a', name: 'A' }],
      fetchGroups: async () => { throw new Error('boom'); },
      fetchCircles: async () => [{ id: 'b', name: 'B' }],
    });
    expect(list.map((c) => c.id).sort()).toEqual(['a', 'b']);
  });

  it('sorts most-recent-activity first, then by name', async () => {
    const list = await loadCircles({
      fetchCircles: async () => [
        { id: 'old', name: 'Old', lastActivity: '2026-01-01T00:00:00Z' },
        { id: 'new', name: 'New', lastActivity: '2026-05-01T00:00:00Z' },
        { id: 'z', name: 'Zeta' },
        { id: 'a', name: 'Alpha' },
      ],
    });
    expect(list.map((c) => c.id)).toEqual(['new', 'old', 'a', 'z']);
  });

  it('returns an empty list when no fetchers are given', async () => {
    expect(await loadCircles()).toEqual([]);
  });
});
