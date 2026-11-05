/**
 * Still in a circle? The fold's own verdict: a device is in a circle while the derived roster holds ITS ROW (looked up by
 * its circle self). Right after a join the row is there before this device's per-circle address lands on it — that is
 * "not yet listed", not removed; reading it as removed made the household bot's box forget a circle it had just joined
 * (its join record wiped, every member's ask refused). An admin's evict removes the row: that, and only that, is removed.
 */
import { describe, it, expect } from 'vitest';
import { stillInCircle } from '../../src/v2/circleMembershipHygiene.js';

const ann = { webid: 'ann', circleAddress: 'A1', circleAddresses: ['A1'] };
const bob = { webid: 'bob', circleAddress: 'B1', circleAddresses: ['B1'] };

describe('still in a circle', () => {
  it('just joined: my row is on the roster but my address has not landed on it yet → still in', () => {
    const v = stillInCircle({ members: [{ webid: 'box', circleAddress: '', circleAddresses: [] }, ann, bob], me: 'X1', selfRef: 'box' });
    expect(v.in, `read as removed: ${v.reason}`).toBe(true);
  });
  it('my row with my address → still in', () => {
    expect(stillInCircle({ members: [{ webid: 'box', circleAddress: 'X1', circleAddresses: ['X1'] }, ann], me: 'X1', selfRef: 'box' }).in).toBe(true);
  });
  it('the admin evicted me: my row is gone from the roster → removed', () => {
    const v = stillInCircle({ members: [ann], me: 'X1', selfRef: 'box' });
    expect(v).toEqual({ in: false, reason: 'not-on-roster' });
  });
  it('a roster that could not be read, or is empty, says nothing about me → still in', () => {
    expect(stillInCircle({ members: null, me: 'X1', selfRef: 'box' }).in).toBe(true);
    expect(stillInCircle({ members: [], me: 'X1', selfRef: 'box' }).in).toBe(true);
  });
});
