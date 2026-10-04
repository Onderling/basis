/**
 * A member who LEFT a circle and joins it again with the same invite is a member again — on the admin's roster and on
 * their own — not told "joined" while the roster still folds their leave. The admin's redeem used to answer the second
 * redemption of the same invite by the same identity as an idempotent repeat ("already redeemed") and wrote no new join
 * statement, so the earlier leave stood (found by the bot-joins-circle walk, ledger L193).
 *
 * Real agents, with device logs (the membership lane), over the in-process bus.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectNodesOverBus, until, teardown, createCircle, joinExistingCircle, readRoster, bindCircleAddresses } from './support/pairRealAgents.js';
import { bindCircleAddressKeysFor, makeCircleReachable } from '../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../src/v2/circleSecurityPriming.js';
import { leaveCircleLocally, removeCircleMember } from '../src/v2/circleMembershipHygiene.js';

const CIRCLE = 'rejoin-circle';

describe('a member who left joins again', () => {
  let ann; let bob; let cas;
  afterAll(async () => { await teardown(ann, bob, cas); });

  it('back on the admin\'s roster after a leave and a second join with the same invite', async () => {
    ann = await bootRealAgentNode('ann', { taskLane: true });
    bob = await bootRealAgentNode('bob', { taskLane: true });
    await connectNodesOverBus([ann, bob]);
    await createCircle(ann, { groupId: CIRCLE, name: 'Rejoin', purpose: 'test' });
    const first = await joinExistingCircle(ann, bob, { groupId: CIRCLE, handle: 'bob' });
    expect(first.joined?.ok).toBe(true);
    await bindCircleAddresses([ann, bob], CIRCLE);
    await Promise.all([ann, bob].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    const isOn = async (node) => (await readRoster(node, CIRCLE)).some((m) => m.handle === 'bob');
    expect(await until(async () => ((await isOn(ann)) ? true : null), { timeout: 10_000, step: 100 })).toBe(true);
    expect(await until(async () => ((await isOn(bob)) ? true : null), { timeout: 10_000, step: 100 }), 'Bob sees himself after the first join').toBe(true);

    const left = await leaveCircleLocally({ agent: bob.agent, circleId: CIRCLE });
    expect(left.ok, JSON.stringify(left)).toBe(true);
    expect(await until(async () => (!(await isOn(ann)) ? true : null), { timeout: 10_000, step: 100 }), 'the leave never reached Ann').toBe(true);

    const again = await joinExistingCircle(ann, bob, { groupId: CIRCLE, handle: 'bob' });
    expect(again.joined?.ok, JSON.stringify(again.joined)).toBe(true);
    // what every shell does after a join (its `onJoined`): presence in the circle again — the leave dropped it — the
    // members' keys bound, the membership lane pulled
    await makeCircleReachable({
      agent: bob.agent, circleId: CIRCLE,
      registerCirclePresence: async () => { await primeCircleSecurity({ agent: bob.agent, circleIds: [CIRCLE] }); await bindCircleAddresses([bob], CIRCLE); },
      pullLanes: (cid) => bob.membershipCatchUp?.requestCircle(cid, { callSkill: (a, o, x) => bob.agent.callSkill(a, o, x) }),
    });
    await bindCircleAddressKeysFor({ agent: ann.agent, circleId: CIRCLE });
    const back = await until(async () => ((await isOn(ann)) ? true : null), { timeout: 10_000, step: 100 });
    expect(back, `Bob is not back on Ann's roster: ${JSON.stringify((await readRoster(ann, CIRCLE)).map((m) => m.handle))}`).toBe(true);
    const bobBack = await until(async () => ((await isOn(bob)) ? true : null), { timeout: 10_000, step: 100 });
    const mine = await bob.agent.callSkill('stoop', 'listMyCircles', {});
    const stmts = (bob.deviceLog?.query?.({}) ?? []).filter((e) => e.circleId === CIRCLE).map((e) => [e.payload?.body?.kind, String(e.payload?.body?.subject ?? '').slice(0, 6), String(e.payload?.body?.author ?? '').slice(0, 6)]);
    const red = ((await bob.agent.callSkill('stoop', 'listOpen', { type: 'membership-redemption' }))?.items ?? []).filter((i) => i.source?.groupId === CIRCLE).map((i) => [String(i.source?.redeemedBy).slice(0, 6), i.source?.redeemedAt]);
    expect(bobBack, `Bob does not see himself back. bob=${String(bob.pubKey).slice(0, 6)} circles=${JSON.stringify(mine?.circles)} left=${JSON.stringify(mine?.left)} log=${JSON.stringify(stmts)} redemptions=${JSON.stringify(red)} again=${JSON.stringify(again.joined)}`).toBe(true);
  }, 120_000);

  it('one the admin REMOVED does not walk back in on the old invite: refused, not on the roster', async () => {
    cas = await bootRealAgentNode('cas', { taskLane: true });
    await connectNodesOverBus([ann, bob, cas]);
    const first = await joinExistingCircle(ann, cas, { groupId: CIRCLE, handle: 'cas' });
    expect(first.joined?.ok).toBe(true);
    await bindCircleAddresses([ann, cas], CIRCLE);
    await Promise.all([ann, cas].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: CIRCLE })));
    const casRow = await until(async () => (await readRoster(ann, CIRCLE)).find((m) => m.handle === 'cas') ?? null, { timeout: 10_000, step: 100 });
    expect(casRow).toBeTruthy();
    const removed = await removeCircleMember({ agent: ann.agent, circleId: CIRCLE, memberWebid: casRow.webid });
    expect(removed.ok, JSON.stringify(removed)).toBe(true);
    // the same invite (the admin's code did not change): refused, said as a removal
    const again = await joinExistingCircle(ann, cas, { groupId: CIRCLE, handle: 'cas' });
    expect(again.joined?.ok, JSON.stringify(again.joined)).not.toBe(true);
    expect(JSON.stringify(again.joined)).toContain('removed-from-circle');
    expect((await readRoster(ann, CIRCLE)).some((m) => m.handle === 'cas')).toBe(false);
  }, 120_000);
});
