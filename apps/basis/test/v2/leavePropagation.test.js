/**
 * A voluntary LEAVE reaches the rest of the circle (cycle 2).
 *
 * Nothing covered this before: the survey found leave was only ever asserted on the LEAVER's own
 * device. It matters because a departure nobody hears about is a person who keeps receiving a
 * circle's content after leaving it.
 *
 * It also pins a COMPOSITION difference worth knowing. `leaveGroup` emits a `leave` spine statement,
 * but a statement needs a lane to travel on: in the basis composition (device log → membership lane →
 * fan → verify-at-the-rail) it arrives and folds, which is what this test proves. In the
 * stoop/substrate-mirror composition the e2e journeys use, there is no membership rail, so the same
 * op leaves the circle's view of the roster unchanged — that is a property of that harness, not of
 * the product, and the roles journey says so in place.
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses,
  until, teardown,
} from '../support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

const CIRCLE = 'leave-probe-circle';

function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) { handler(env?.from, env.payload); return undefined; }
    return inner?.(env);
  };
}

describe('PROBE — a voluntary leave reaches the circle', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('when B leaves, A stops listing B as a member', async () => {
    // `taskLane: true` composes a DEVICE LOG, which is what builds the membership rail.
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }),
      bootRealAgentNode('B', { taskLane: true }),
    ]);
    await connectNodesOverBus([A, B]);
    for (const n of [A, B]) wireMembershipReceiver(n);
    await createCircle(A, { groupId: CIRCLE, name: 'Leave probe' });
    const joined = await joinExistingCircle(A, B, { groupId: CIRCLE, handle: 'bram' });
    expect(joined.joined?.ok, JSON.stringify(joined.joined)).toBe(true);
    await bindCircleAddresses([A, B], CIRCLE);

    const rows = async (n) => (await n.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE }))?.members ?? [];
    const hasB = (r) => r.some((m) => (m.webid ?? m.addr ?? m.ref) === B.pubKey);
    expect(hasB(await rows(A)), 'precondition: A sees B as a member').toBe(true);

    // The act: B leaves of their own accord, through the production op.
    // `confirm: true` — leaving is gated as irreversible, which is right; the gate is not what
    // this probe is about.
    const left = await B.agent.callSkill('stoop', 'leaveGroup', { groupId: CIRCLE, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();

    // B's own device must reflect it…
    const goneLocally = await until(async () => (!hasB(await rows(B)) ? true : null), { timeout: 8000, step: 100 });
    expect(goneLocally, 'the leaver\'s own device drops the membership').toBe(true);

    // …and so must A's. This is the half the roles journey found missing elsewhere.
    const goneForA = await until(async () => (!hasB(await rows(A)) ? true : null), { timeout: 12000, step: 150 });
    expect(goneForA, 'the circle learns that B left — otherwise the departure is invisible and content keeps fanning to them').toBe(true);
  }, 120_000);
});
