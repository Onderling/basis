/**
 * A CIRCLE YOU WERE REMOVED FROM STAYS UNTIL YOU CLOSE IT. Once an admin's evict folds, the circle leaves "my circles"
 * (its security half ran) and is listed as `removed`: the person can still read what they had. Closing it is
 * `dismissRemovedCircle`, which forgets what this device held of the circle and the rows that listed it here, and
 * refuses for any circle the fold does not say they were removed from.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from '../support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const GONE = 'dismiss-removed';
const KEPT = 'dismiss-kept';
function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

describe('closing a circle you were removed from', () => {
  let A; let C;
  afterAll(async () => { await teardown(A, C); });

  it('refuses for a circle you are still in; for the removed one it forgets it, and it stays gone', async () => {
    [A, C] = await Promise.all(['A', 'C'].map((l) => bootRealAgentNode(l, { itemsLane: true })));
    await connectNodesOverBus([A, C]);
    for (const n of [A, C]) wireMembershipReceiver(n);
    for (const [g, name] of [[GONE, 'Weg'], [KEPT, 'Blijft']]) {
      await createCircle(A, { groupId: g, name });
      const j = await joinExistingCircle(A, C, { groupId: g, handle: 'cas' });
      expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
      await bindCircleAddresses([A, C], g);
    }
    const mine = () => C.agent.callSkill('pinboard', 'listMyCircles', {});
    const dismiss = (groupId) => C.agent.callSkill('pinboard', 'dismissRemovedCircle', { groupId });

    const refusedIn = await dismiss(KEPT);
    expect(refusedIn?.ok, JSON.stringify(refusedIn)).not.toBe(true);
    expect((await mine())?.circles ?? [], 'refused: the circle is still mine').toContain(KEPT);

    const removed = await A.agent.callSkill('pinboard', 'removeMember', { groupId: GONE, memberWebid: C.pubKey });
    expect(removed?.error, JSON.stringify(removed)).toBeUndefined();
    expect(await until(async () => (((await mine())?.removed ?? []).some((r) => r.id === GONE) ? true : null), { timeout: 10000, step: 150 }),
      'C sees the circle as removed').toBe(true);

    const done = await dismiss(GONE);
    expect(done?.ok, JSON.stringify(done)).toBe(true);
    const after = await mine();
    expect(after?.circles ?? [], 'not one of my circles').not.toContain(GONE);
    expect((after?.removed ?? []).map((r) => r.id), 'and no longer listed as removed').not.toContain(GONE);
    expect(after?.circles ?? [], 'the other circle is untouched').toContain(KEPT);
    expect(await C.agent.circleStoreFor(GONE).list?.() ?? [], 'nothing of the circle is held here').toEqual([]);
    expect((await dismiss(GONE))?.ok, 'a second close is refused: it is gone').not.toBe(true);
  }, 120_000);
});
