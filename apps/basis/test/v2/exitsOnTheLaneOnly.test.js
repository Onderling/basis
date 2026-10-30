/**
 * A LEAVE AND A REMOVAL LIVE ON THE MEMBERSHIP LANE ONLY.
 *
 * The lane has carried `leave` and `evict` statements, folded deny-wins, since before this test; pinboard also wrote an
 * exit ROW into its own pile (`group-leave` / `group-removal`) that six readers consulted, the list of "my circles"
 * among them. Two records of one fact. The rows go: every reader asks the fold, and a device that left a circle stops
 * listing it because its own `leave` statement folds it out — offline, at boot, with nothing else to read.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { CachingDataSource } from '@onderling/local-store';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from '../support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const CIRCLE = 'exits-on-the-lane';
function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}
// every exit row written into pinboard's pile, by type (written in the clear here, sealed below)
const exitRows = [];
const write = CachingDataSource.prototype.write;
vi.spyOn(CachingDataSource.prototype, 'write').mockImplementation(async function (p, data) {
  if (String(p).startsWith('mem://neighbourhood/items/')) {
    let t = null; try { t = JSON.parse(data)?.type; } catch { /* not JSON */ }
    if (t === 'group-leave' || t === 'group-removal') exitRows.push(t);
  }
  return write.call(this, p, data);
});

describe('a leave and a removal are statements on the lane, not rows in a pile', () => {
  let A; let B; let C;
  afterAll(async () => { await teardown(A, B, C); vi.restoreAllMocks(); });

  it('B leaves, C is removed: no exit row is written, and each drops the circle from its own list', async () => {
    [A, B, C] = await Promise.all(['A', 'B', 'C'].map((l) => bootRealAgentNode(l, { itemsLane: true })));
    await connectNodesOverBus([A, B, C]);
    for (const n of [A, B, C]) wireMembershipReceiver(n);
    await createCircle(A, { groupId: CIRCLE, name: 'Exits' });
    for (const [n, h] of [[B, 'bram'], [C, 'cas']]) {
      const j = await joinExistingCircle(A, n, { groupId: CIRCLE, handle: h });
      expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
    }
    await bindCircleAddresses([A, B, C], CIRCLE);
    const mine = async (n) => (await n.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? [];
    expect(await mine(B)).toContain(CIRCLE);

    const left = await B.agent.callSkill('pinboard', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();
    const removed = await A.agent.callSkill('pinboard', 'removeMember', { groupId: CIRCLE, memberWebid: C.pubKey });
    expect(removed?.error, JSON.stringify(removed)).toBeUndefined();

    expect(await until(async () => (!(await mine(B)).includes(CIRCLE) ? true : null), { timeout: 8000, step: 100 }),
      'the leaver no longer lists the circle').toBe(true);
    const members = async (n) => ((await n.agent.callSkill('pinboard', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? []).map((m) => m.webid);
    expect(await until(async () => (!(await members(A)).includes(B.pubKey) && !(await members(A)).includes(C.pubKey) ? true : null), { timeout: 12000, step: 150 }),
      'the admin folds both out').toBe(true);
    expect(exitRows, 'no exit row is written into pinboard\'s pile').toEqual([]);
  }, 120_000);
});
