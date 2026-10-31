/**
 * THE MIGRATION TO ONE ADDRESS PER PERSONA. A membership from before the switch lists the person's DEVICE-derived
 * addresses on every co-member's row. Each device now presents the persona's one address (and the boot re-announce puts
 * it on the rows); the device holding the root then retires the old device addresses — its own and those of the
 * siblings its device map names — with the authority's reveal, as the revoke ceremony does. The persona address stays.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ownCircleAddressAnnouncementFromSeed } from '@onderling/core';
import {
  bootRealAgentNode, connectNodesOverBus, pairCircle, until, teardown,
} from './support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'migration-walk';
const rowFor = async (node, webid) => {
  const res = await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP });
  return (res?.members ?? []).find((m) => m.webid === webid) ?? null;
};
const addrsOf = (row) => [row?.circleAddress, ...(row?.circleAddresses ?? [])].filter(Boolean);

describe('the migration to one address per persona', () => {
  let A; let B;
  beforeAll(async () => {
    const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    [A, B] = await Promise.all([bootRealAgentNode('A', { agentOpts: log() }), bootRealAgentNode('B', { agentOpts: log() })]);
    await connectNodesOverBus([A, B]);
    await pairCircle(A, B, { groupId: GROUP, name: 'Migratie', handle: 'bea' });
    const onMembership = makeMembershipPeerHandler({ rail: B.agent.membershipRail });
    const prior = B._routerRef.fn;
    B._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_BROADCAST ? onMembership(env.from, env.payload) : prior?.(env));
  }, 120_000);
  afterAll(async () => { await teardown(A, B); });

  it('the root device retires its old device-derived address on the co-member\'s row; the persona address stays', async () => {
    const persona = A.agent.circleAddressFor(GROUP);
    // the persona address announced with its ceremony commitment — what the boot re-announce does in production
    const mine = ownAnnouncementFor({ agent: A.agent, circleId: GROUP });
    for (const node of [A, B]) await node.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...mine });
    // the world before the switch: A's DEVICE-derived address, proven, on Bea's row (and its own)
    const old = ownCircleAddressAnnouncementFromSeed({ derivationSeed: A.agent.persona('default').deviceDerivationSeed, circleId: GROUP, memberWebid: A.pubKey });
    expect(old.circleAddress).not.toBe(persona);
    for (const node of [A, B]) await node.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, ...old });
    expect(addrsOf(await rowFor(B, A.pubKey)), 'the old address is on Bea\'s row').toContain(old.circleAddress);

    const r = await A.agent.retireDeviceCircleAddresses([GROUP]);
    expect(r?.retired, JSON.stringify(r)).toBe(1);
    expect(await until(async () => (addrsOf(await rowFor(B, A.pubKey)).includes(old.circleAddress) ? null : true), { timeout: 15000, step: 100 }),
      'Bea\'s row still names the old device address').toBe(true);
    expect(addrsOf(await rowFor(B, A.pubKey)), 'the persona address stays').toContain(persona);
    // idempotent: a second pass retires nothing
    expect((await A.agent.retireDeviceCircleAddresses([GROUP]))?.retired).toBe(0);
  }, 60_000);
});
