/**
 * basis — after a join, the JOINER holds a per-circle address for the ADMIN (2026-07-30).
 *
 * Per-circle addressing was one-directional: the joiner presented + proved its address, the admin
 * recorded it, and nothing flowed back. So the admin could reach the joiner, while the joiner knew the
 * admin only as `confirmedBy` — a global signing key — and a send to them was refused outright whenever
 * the per-user address-fallback setting is off (the default). Measured on hardware: admin→joiner chat
 * worked, joiner→admin did not.
 *
 * The fix rides on the redeem RESPONSE. This is the whole-app version of it: two REAL agents, the real
 * join over the real peer bridge, then the joiner's own roster read.
 *
 * The address ladder itself (`resolveMemberAddress` with `allowFallback:false`) is pinned in
 * `apps/stoop/test/adminCircleAddressOnJoin.test.js`, which is where that code lives; what this gate
 * adds is that a genuine join actually produces the two facts the ladder needs.
 */
import { describe, it, expect, afterAll } from 'vitest';

import {
  bootRealAgentNode, connectAgentsOverBus, pairCircle, readRoster, until, teardown,
} from './support/pairRealAgents.js';

describe('a real join gives the joiner the admin\'s per-circle address', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('the joiner\'s roster row for the admin carries {circleAddress, pubKey}', async () => {
    [A, B] = await Promise.all([bootRealAgentNode('A'), bootRealAgentNode('B')]);
    await connectAgentsOverBus(A, B);

    const groupId = 'peer-circle';
    const { joined } = await pairCircle(A, B, { groupId, name: 'Peer Circle', handle: 'peerbee' });
    expect(joined.ok).toBe(true);

    const bRoster = await until(async () => {
      const r = await readRoster(B, groupId);
      return r.length >= 2 ? r : null;
    });
    const adminOnB = bRoster.find((m) => m.webid === A.pubKey);
    expect(adminOnB, 'the joiner sees the admin at all').toBeTruthy();

    // The address the ADMIN itself derives for this circle — proven on the response, verified on
    // arrival. Anything else here would mean the joiner recorded a claim rather than a proof.
    expect(adminOnB.circleAddress).toBe(A.agent.circleAddressFor(groupId));
    // …and the signing key the address must be bound to before anything can be sealed to it.
    expect(adminOnB.pubKey).toBe(A.pubKey);

    // Symmetry check: the admin has held the joiner's address since before this change, and still does.
    const aRoster = await readRoster(A, groupId);
    const joinerOnA = aRoster.find((m) => m.webid === B.pubKey);
    expect(joinerOnA.circleAddress).toBe(B.agent.circleAddressFor(groupId));
  });
});
