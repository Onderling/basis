/**
 * A LEAVE HANDED TO THE MAIN DEVICE SAYS SO. On a device that is not the person's point, the signed `leave` is made on
 * the point: the spine emit forwards it and answers `{ forwarded, held? }`. The leave is not applied here until it
 * lands back, so the caller must hear that, and not read "done" when the circle is still in the list.
 */
import { describe, it, expect } from 'vitest';
import { leaveGroup } from '../src/circleMembershipWriters.js';

const deps = (emitResult) => ({
  store: { listOpen: async () => [], removeItems: async () => {} },
  simulateSync: () => ({}),
  notifier: null,
  revokeKey: async () => {},
  emitSpine: async () => emitResult,
});

describe('leaveGroup reports a forwarded leave', () => {
  it('forwarded to the point: the result says so', async () => {
    const r = await leaveGroup(deps({ forwarded: true }), { a: { groupId: 'c1' }, from: 'me' });
    expect(r).toMatchObject({ forwarded: true, held: false });
  });
  it('forwarded while the point is offline: held', async () => {
    const r = await leaveGroup(deps({ forwarded: true, held: true }), { a: { groupId: 'c1' }, from: 'me' });
    expect(r).toMatchObject({ forwarded: true, held: true });
  });
  it('signed here: no forwarded mark', async () => {
    const r = await leaveGroup(deps({ hash: 'h1' }), { a: { groupId: 'c1' }, from: 'me' });
    expect(r.forwarded).toBeUndefined();
    expect(r.deletedItems).toBe(0);
  });
});
