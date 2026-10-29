/**
 * A roster-trail row never rides the items lane, on either side: put in a circle store it is not published as a
 * snapshot, and one that arrives is not applied (rosterTrail.js: the roster converges by its own carriers).
 */
import { describe, it, expect, vi } from 'vitest';
import { routeItemsMirror } from '../../src/v2/itemsRail.js';

const trail = { id: 'r1', type: 'membership-redemption', source: { groupId: 'g', redeemedBy: 'pk-bram' } };
const post = { id: 'p1', type: 'request', text: 'een ladder', source: { groupId: 'g' } };
const rules = { id: 'gr1', type: 'group-rules', text: 'kring', source: { groupId: 'g', rules: {}, version: 2 } };

describe('the items lane and the roster trail', () => {
  it('a trail row written to a circle store is not published on the lane; any other row is', () => {
    const emitter = { snapshot: vi.fn(() => ({ ok: true })), remove: vi.fn() };
    const valve = routeItemsMirror({ circleId: 'g', emitter });
    valve.publishItem(trail);
    valve.publishItem(rules);   // the rules head, too: its own lane carries it
    expect(emitter.snapshot).not.toHaveBeenCalled();
    valve.publishItem(post);
    expect(emitter.snapshot).toHaveBeenCalledTimes(1);
  });
});
