/**
 * A person who left a circle (or was removed) and joins it again is in it again. Since a leave lives only on the
 * membership lane, "my circles" asks the fold — so the re-join must reach the joiner's fold. A device that has left no
 * longer hears the circle's fan, so the admitting admin's signed join travels back on the redeem reply and the joiner
 * ingests it through its own membership rail: that is the only road it gets here (the fan to the joiner is cut).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown } from '../support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../../src/v2/membershipRail.js';

/** The membership fan on the bus — and a switch that stops it reaching a device that has left. */
function wireMembershipReceiver(node) {
  const handler = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const inner = node._routerRef.fn;
  node.deaf = new Set();
  node._routerRef.fn = (env) => {
    if (env?.payload?.subtype === MEMBERSHIP_BROADCAST) {
      if (!node.deaf.has(env.payload.circleId)) handler(env?.from, env.payload);
      return undefined;
    }
    return inner?.(env);
  };
}

async function boot() {
  const nodes = await Promise.all(['A', 'B'].map((l) => bootRealAgentNode(l, { itemsLane: true })));
  await connectNodesOverBus(nodes);
  for (const n of nodes) wireMembershipReceiver(n);
  return nodes;
}
const mine = async (n) => (await n.agent.callSkill('pinboard', 'listMyCircles', {}))?.circles ?? [];
const roster = async (n, groupId) => ((await n.agent.callSkill('pinboard', 'listGroupMembers', { groupId }))?.members ?? []).map((m) => m.webid);
const selfIn = (n, groupId) => n.agent.circleSelf?.(groupId)?.webid ?? n.pubKey;

/** After the exit: the circle's fan no longer reaches B; A invites again; B is back in its own circles and roster. */
async function rejoins(A, B, groupId) {
  B.deaf.add(groupId);
  expect(await mine(B), 'out after the exit').not.toContain(groupId);
  const again = await joinExistingCircle(A, B, { groupId, handle: 'bea' });
  expect(again.joined?.ok, JSON.stringify(again.joined ?? again.error)).toBe(true);
  const back = await until(async () => ((await mine(B)).includes(groupId) ? true : null), { timeout: 10_000, step: 200 });
  const onB = await roster(B, groupId);
  return { back, bOnOwnRoster: onB.includes(selfIn(B, groupId)) };
}

describe('leave or removal, then join again', () => {
  let A; let B;
  afterEach(async () => { await teardown(A, B); A = null; B = null; });

  it('a member who left is in the circle again', async () => {
    [A, B] = await boot();
    const id = 'rejoin-after-leave';
    await createCircle(A, { groupId: id, name: 'Terug' });
    expect((await joinExistingCircle(A, B, { groupId: id, handle: 'bea' })).joined?.ok).toBe(true);
    await bindCircleAddresses([A, B], id);
    const left = await B.agent.callSkill('pinboard', 'leaveGroup', { groupId: id, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();
    expect(await rejoins(A, B, id)).toEqual({ back: true, bOnOwnRoster: true });
  }, 120_000);

  it('the FOUNDER who left is brought back by the member who stayed (an admin there)', async () => {
    [A, B] = await boot();
    const id = 'rejoin-founder';
    await createCircle(B, { groupId: id, name: 'Van B' });
    expect((await joinExistingCircle(B, A, { groupId: id, handle: 'anna' })).joined?.ok).toBe(true);
    await bindCircleAddresses([A, B], id);
    const promoted = await B.agent.callSkill('pinboard', 'setMemberRole', { groupId: id, memberWebid: selfIn(A, id), role: 'admin' });
    expect(promoted?.ok, JSON.stringify(promoted)).toBe(true);
    await until(async () => ((await A.agent.callSkill('pinboard', 'listGroupMembers', { groupId: id }))?.members ?? [])
      .some((m) => m.webid === selfIn(A, id) && m.role === 'admin') || null, { timeout: 10_000, step: 200 });
    const left = await B.agent.callSkill('pinboard', 'leaveGroup', { groupId: id, confirm: true });
    expect(left?.error, JSON.stringify(left)).toBeUndefined();
    await until(async () => (!(await roster(A, id)).includes(selfIn(B, id)) ? true : null), { timeout: 10_000, step: 200 });
    expect(await rejoins(A, B, id)).toEqual({ back: true, bOnOwnRoster: true });
  }, 120_000);

  it('a member who was removed is in the circle again on a new invite', async () => {
    [A, B] = await boot();
    const id = 'rejoin-after-evict';
    await createCircle(A, { groupId: id, name: 'Weg en terug' });
    expect((await joinExistingCircle(A, B, { groupId: id, handle: 'bea' })).joined?.ok).toBe(true);
    await bindCircleAddresses([A, B], id);
    const removed = await A.agent.callSkill('pinboard', 'removeMember', { groupId: id, memberWebid: selfIn(B, id) });
    expect(removed?.error, JSON.stringify(removed)).toBeUndefined();
    await until(async () => (!(await mine(B)).includes(id) ? true : null), { timeout: 10_000, step: 200 });
    // the code they redeemed does not undo the removal; the way back is a new one from an admin
    const rotated = await A.agent.callSkill('pinboard', 'rotateMyGroupCode', { groupId: id });
    expect(rotated?.error, JSON.stringify(rotated)).toBeUndefined();
    expect(await rejoins(A, B, id)).toEqual({ back: true, bOnOwnRoster: true });
  }, 120_000);
});
