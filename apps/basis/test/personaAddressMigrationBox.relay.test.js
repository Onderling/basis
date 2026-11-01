/**
 * THE MIGRATION NEVER CUTS A DEVICE OUT. A device enrolled before the persona circle root existed holds no root slot: it
 * still speaks ONLY on its device-derived address in every circle. The device holding the root retires only its OWN old
 * address at the migration; a sibling's old address is retired only at that sibling's request, which it makes once it
 * holds the circle root and its persona address is on its row. A root-less device never asks, so it keeps its address
 * (the device count shows for it, stated) until a phrase ceremony hands it the root.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown, shareDeviceRecords,
} from './support/pairRealAgents.js';
import { startJourneyRelay } from './support/testRelay.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { ownAnnouncementFor } from '../src/v2/circleAddressAnnounce.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'migration-box';
const rowFor = async (node, webid) => {
  const res = await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP });
  return (res?.members ?? []).find((m) => m.webid === webid) ?? null;
};
const addrsOf = (row) => [row?.circleAddress, ...(row?.circleAddresses ?? [])].filter(Boolean);
const wireMembership = (node) => {
  const on = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
  const prior = node._routerRef.fn;
  node._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_BROADCAST ? on(env.from, env.payload) : prior?.(env));
};

describe('the migration never cuts a device out', () => {
  let A; let B; let box; let boxVaults; let relay;
  beforeAll(async () => {
    const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    [A, B] = await Promise.all([bootRealAgentNode('A', { agentOpts: log() }), bootRealAgentNode('B', { agentOpts: log() })]);
    relay = await startJourneyRelay();
    await connectNodesOverRelay([A, B], { relayUrl: relay.url });
    await pairCircle(A, B, { groupId: GROUP, name: 'Box blijft', handle: 'bea' });
    await bindCircleAddresses([A, B], GROUP);
    wireMembership(B);
    // the box: enrolled with the phrase, then its circle-root slot removed — a device enrolled before the root existed
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    boxVaults = vaults;
    const pre = await bootRealAgentNode('box-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    const probe = await bootRealAgentNode('box-probe', { agentOpts: vaults });
    const slots = (await probe.agent.persona('default').vault.get('circle-root')) ? true : false;
    await probe.agent.persona('default').vault.set?.('circle-root', '');
    await teardown(probe);
    expect(slots, 'the ceremony handed the box a root (removed above to stand for a pre-root box)').toBe(true);
    box = await bootRealAgentNode('box', { agentOpts: { ...vaults, ...log() } });
    await connectNodesOverRelay([box], { relayUrl: relay.url });
    await bindCircleAddresses([box], GROUP);
    await shareDeviceRecords([A, box], 'default');
  }, 180_000);
  afterAll(async () => { await teardown(A, B, box); await relay?.close?.(); });

  it('the root device retires its own old address only; the root-less box keeps its address on the row', async () => {
    const boxAddr = box.agent.circleAddressFor(GROUP);
    expect(boxAddr, 'the root-less box speaks on its own device-derived address').not.toBe(A.agent.circleAddressFor(GROUP));
    const mine = ownAnnouncementFor({ agent: A.agent, circleId: GROUP });
    const boxAnn = ownAnnouncementFor({ agent: box.agent, circleId: GROUP });
    for (const node of [A, B]) {
      await node.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...mine });
      await node.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, memberWebid: A.pubKey, ...boxAnn });
    }
    expect(addrsOf(await rowFor(B, A.pubKey)), 'the box is on Bea\'s row').toContain(boxAddr);
    await A.agent.retireDeviceCircleAddresses([GROUP]);
    await new Promise((r) => setTimeout(r, 1500));
    expect(addrsOf(await rowFor(B, A.pubKey)), 'the migration cut the root-less box out of the circle').toContain(boxAddr);
    expect(addrsOf(await rowFor(A, A.pubKey))).toContain(boxAddr);
    // …and the root-less box asks nothing: it holds no circle root, so it has no other address to move to
    expect((await box.agent.retireDeviceCircleAddresses([GROUP]))?.asked).toBe(0);
  }, 60_000);

  it('a device that HOLDS the circle root asks the root device to retire its old address — and only that one goes', async () => {
    // the box after a phrase ceremony handed it the root: the slot back, a reboot, its persona address on the row
    const { Bootstrap, deriveCircleRoot } = await import('@onderling/core');
    const { seedToString } = await import('@onderling/vault');
    const pSeed = Bootstrap.fromMnemonic((await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic).deriveAgentSeed('default');
    await box.agent.persona('default').vault.set('circle-root', JSON.stringify({ epoch: 0, seed: seedToString(deriveCircleRoot(pSeed, 0)) }));
    const oldBox = box.agent.circleAddressFor(GROUP);
    await teardown(box);
    const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });
    box = await bootRealAgentNode('box2', { agentOpts: { ...boxVaults, ...log() } });
    await connectNodesOverRelay([box], { relayUrl: relay.url });
    await bindCircleAddresses([box], GROUP);
    await shareDeviceRecords([A, box], 'default');
    expect(box.agent.circleAddressFor(GROUP), 'the box now presents the persona address').toBe(A.agent.circleAddressFor(GROUP));
    // the box's own roster, as the enrol seed gives it: asked of the phone at its device address
    const req = await box.agent.rosterSeed.buildRequest(GROUP, box.agent.ownDeviceAddress('default'));
    await box.agent.sendPeerMessage(A.agent.ownDeviceAddress('default'), req, { circleId: GROUP });
    expect(await until(async () => (addrsOf(await rowFor(box, A.pubKey)).includes(oldBox) ? true : null), { timeout: 15000, step: 100 }),
      'the box never got the person\'s row with its old address').toBe(true);
    const r = await box.agent.retireDeviceCircleAddresses([GROUP]);
    expect(r.asked, JSON.stringify(r)).toBeGreaterThanOrEqual(1);
    expect(await until(async () => (addrsOf(await rowFor(B, A.pubKey)).includes(oldBox) ? null : true), { timeout: 15000, step: 100 }),
      'Bea\'s row still names the box\'s old address').toBe(true);
    expect(addrsOf(await rowFor(B, A.pubKey)), 'the persona address stays').toContain(A.agent.circleAddressFor(GROUP));
  }, 90_000);
});
