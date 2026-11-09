/**
 * The set-union resolution policy, told as a person's devices marking what they read.
 *
 * A `read-marks` row (one per group: a circle, a contact) holds the ids the person has read, each with the SOURCE's own
 * time (the same on every device). Two devices that mark at once must both keep their marks: the set only grows, so the
 * merge is a union, whichever side wins the row's content. Old marks are pruned by a floor (`prunedBefore`) that merges
 * by its maximum, and the union keeps only marks at or after the floor, so a device that never pruned cannot bring a
 * pruned mark back.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { defaultResolutionRegistry, RESOLUTION, createResolutionRegistry } from '../src/resolutionPolicy.js';
import { mergeSetUnion } from '../src/causalMerge.js';

const device = () => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: 'mem://own/' });
const BASE = { id: 'read-marks:me:c1', type: 'read-marks', group: 'c1', read: [{ id: 'm1', at: 100 }], prunedBefore: 0 };

async function twoDevicesAndAThird() {
  const A = device(); const B = device(); const C = device();
  const base = await A.put(BASE, { by: 'me' });
  await B.put(base, { origin: true, sync: false });
  await C.put(base, { origin: true, sync: false });
  return { A, B, C };
}
const ids = (row) => (row?.read ?? []).map((r) => r.id).sort();

describe('read marks merge as a union', () => {
  it('A reads m2 and B reads m3 at once: C holds m1, m2 and m3, in either arrival order', async () => {
    for (const order of ['A-then-B', 'B-then-A']) {
      const { A, B, C } = await twoDevicesAndAThird();
      const onA = await A.put({ ...(await A.get(BASE.id)), read: [...BASE.read, { id: 'm2', at: 200 }] }, { by: 'me' });
      const onB = await B.put({ ...(await B.get(BASE.id)), read: [...BASE.read, { id: 'm3', at: 300 }] }, { by: 'me' });
      const [first, second] = order === 'A-then-B' ? [onA, onB] : [onB, onA];
      await C.put(first, { origin: true, sync: false });
      await C.put(second, { origin: true, sync: false });
      expect({ order, read: ids(await C.get(BASE.id)) }).toEqual({ order, read: ['m1', 'm2', 'm3'] });
    }
  });

  it('a stale device that never pruned cannot bring a pruned mark back', async () => {
    const { A, B } = await twoDevicesAndAThird();
    // A prunes everything before 150 (m1 at 100 goes) and reads m2
    const pruned = await A.put({ ...(await A.get(BASE.id)), read: [{ id: 'm2', at: 200 }], prunedBefore: 150 }, { by: 'me' });
    // B, stale, still holds m1 and reads m3
    const stale = await B.put({ ...(await B.get(BASE.id)), read: [{ id: 'm1', at: 100 }, { id: 'm3', at: 300 }] }, { by: 'me' });
    await A.put(stale, { origin: true, sync: false });
    await B.put(pruned, { origin: true, sync: false });
    for (const d of [A, B]) {
      const row = await d.get(BASE.id);
      expect(ids(row)).toEqual(['m2', 'm3']);
      expect(row.prunedBefore).toBe(150);
    }
  });

  it('the merge itself: union by id, floor by max, filtered by the floor', () => {
    const spec = { field: 'read', key: 'id', at: 'at', floor: 'prunedBefore' };
    const out = mergeSetUnion(
      { read: [{ id: 'a', at: 5 }], prunedBefore: 0 },
      { read: [{ id: 'a', at: 5 }], prunedBefore: 0 },
      { read: [{ id: 'b', at: 20 }, { id: 'old', at: 1 }], prunedBefore: 3 },
      [spec],
    );
    expect(out.read.map((r) => r.id).sort()).toEqual(['a', 'b']);
    expect(out.prunedBefore).toBe(3);
  });
});

describe('the set-union declaration', () => {
  it('read-marks declares it; the channel is a named resolution with a delivery tier', () => {
    const r = defaultResolutionRegistry();
    expect(RESOLUTION.SET_UNION).toBe('set-union');
    expect(r.hasChannel('read-marks', RESOLUTION.SET_UNION)).toBe(true);
    expect(r.resolutionOf('read-marks', 'read')).toBe(RESOLUTION.SET_UNION);
    expect(r.deliveryOf('read-marks', 'read')).toBe('best-effort');
  });
  it('is refused for a type outside the own-devices scope (a circle-shared type)', () => {
    expect(() => createResolutionRegistry().declareSetUnion('task', { field: 'read', key: 'id', at: 'at', floor: 'prunedBefore' })).toThrow(/own-devices/);
  });
  it('cannot be declared one field at a time', () => {
    expect(() => createResolutionRegistry().declare('read-marks', 'read', RESOLUTION.SET_UNION)).toThrow(/declareSetUnion/);
  });
});
