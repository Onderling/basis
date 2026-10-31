/**
 * SPINE STATEMENTS ONLY FROM THE POINT (Frits, 2026-10-31). With one address per persona per circle, every full device of
 * the person signs with the same circle key; the fork rule counts a fork per signing key, so two of them writing a spine
 * statement at the same moment (each off its own head) would fork the shared key and cost the person their standing. Only
 * the POINT — the primary-device claim — signs the spine; another device of the person hands its spine act to the point.
 * Chat and items stay any-device: they are not chained.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, pairCircle, bindCircleAddresses, until, teardown, shareDeviceRecords,
} from './support/pairRealAgents.js';
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST } from '../src/v2/membershipRail.js';
import { EventLog } from '../src/eventLog.js';

const GROUP = 'spine-from-point';
const log = () => ({ deviceLog: new EventLog({ initial: [], muted: [] }) });

describe('spine statements only from the point', () => {
  let relay; let A; let B; let A2; let C;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    A = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), ...log() } });
    B = await bootRealAgentNode('bea', { agentOpts: log() });
    C = await bootRealAgentNode('cas', { agentOpts: log() });
    await connectNodesOverRelay([A, B, C], { relayUrl: relay.url });
    await pairCircle(A, B, { groupId: GROUP, name: 'Spine', handle: 'bea' });
    await pairCircle(A, C, { groupId: GROUP, name: 'Spine', handle: 'cas' });
    await bindCircleAddresses([A, B, C], GROUP);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('box-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'box' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('box', { agentOpts: { ...vaults, ...log() } });
    await connectNodesOverRelay([A2], { relayUrl: relay.url });
    await bindCircleAddresses([A2], GROUP);
    await shareDeviceRecords([A, A2], 'default');
    const req = await A2.agent.rosterSeed.buildRequest(GROUP, A2.agent.ownDeviceAddress('default'));
    await A2.agent.sendPeerMessage(A.agent.ownDeviceAddress('default'), req, { circleId: GROUP });
    expect(await until(async () => (((await A2.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).some((m) => m.webid === C.pubKey) ? true : null), { timeout: 20000, step: 100 }),
      'the box never got the roster').toBe(true);
    for (const node of [B, A2]) {
      const on = makeMembershipPeerHandler({ rail: node.agent.membershipRail });
      const prior = node._routerRef.fn;
      node._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_BROADCAST ? on(env.from, env.payload) : prior?.(env));
    }
  }, 240_000);
  afterAll(async () => { await teardown(A, B, C, A2); await relay?.close?.(); });

  it('the phone and the box change two roles at once: Bea sees both, and Anna is NOT disputed (no fork on the shared key)', async () => {
    expect(A2.agent.circleAddressFor(GROUP), 'one address for Anna: both devices sign with one key').toBe(A.agent.circleAddressFor(GROUP));
    // the phone is the point: it claims, and the box holds the claim (the sibling carry)
    await A.agent.claimPrimaryDevice();
    await A2.agent.primaryDevice?.requestFromSiblings?.();
    expect(await until(() => (A2.agent.primaryDeviceClaim()?.deviceId === A.agent.primaryDeviceClaim()?.deviceId ? true : null), { timeout: 15000, step: 200 }),
      'the box never learned that the phone is the point').toBe(true);
    // first, both devices on ONE head: a statement by the phone that the box holds too (the sibling carry)
    const headOf = (node) => (node.agent.membershipRail.storedStatements(GROUP) ?? []).filter((x) => x?.body?.author === A.agent.circleAddressFor(GROUP)).map((x) => x.body.hash);
    const seed = await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: 'member' });
    expect(seed?.error ?? null, JSON.stringify(seed)).toBeNull();
    // (the state preparation: the box holds the phone's whole membership chain, each statement through its own ingest gate)
    for (const stmt of A.agent.membershipRail.storedStatements(GROUP)) await A2.agent.membershipRail.ingest(GROUP, stmt);
    expect(await until(() => { const a = headOf(A); const b = headOf(A2); return a.length && a.every((h) => b.includes(h)) ? true : null; }, { timeout: 20000, step: 200 }),
      `the box never held the phone's chain — phone ${headOf(A).length}, box ${headOf(A2).length}`).toBe(true);
    // then at the same moment, neither having seen the other's: the box hears nothing while both act
    const signedByBox = () => (A2.agent.membershipRail.storedStatements(GROUP) ?? []).length;
    const boxBefore = signedByBox();
    const prior = A2._routerRef.fn;
    A2._routerRef.fn = () => undefined;
    const [r1, r2] = await Promise.all([
      A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: 'admin' }),
      A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: 'admin' }),
    ]);
    await new Promise((r) => setTimeout(r, 1500));
    A2._routerRef.fn = prior;
    expect(signedByBox(), 'the box signed a spine statement itself instead of handing it to the point').toBe(boxBefore);
    expect(r1?.error ?? null, JSON.stringify(r1)).toBeNull();
    expect(r2?.error ?? null, JSON.stringify(r2)).toBeNull();
    const roleOn = async (node, webid) => (((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).find((m) => m.webid === webid)?.role ?? null);
    const both = await until(async () => ((await roleOn(B, B.pubKey)) === 'admin' && (await roleOn(B, C.pubKey)) === 'admin' ? true : null), { timeout: 20000, step: 200 });
    const disputedNow = [...(await B.agent.membershipRail.readVerified(GROUP)).disputed];
    expect(both, `Bea never saw both role changes — disputed on Bea: ${JSON.stringify(disputedNow.map((r) => String(r).slice(0, 8)))} (Anna ${String(A.pubKey).slice(0, 8)})`).toBe(true);
    const { disputed } = await B.agent.membershipRail.readVerified(GROUP);
    expect([...disputed], 'Anna forked her own key: her standing is disputed').not.toContain(A.pubKey);
  }, 90_000);

  it('a CEREMONY on the box (not the point) while the phone writes: the act and its reveal go to the point — one chain, no fork', async () => {
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    const signedByBox = () => (A2.agent.membershipRail.storedStatements(GROUP) ?? []).length;
    const boxBefore = signedByBox();
    const prior = A2._routerRef.fn;
    A2._routerRef.fn = () => undefined;
    const [cer, role] = await Promise.all([
      // a device that never was (a lost one by id): the ceremony rotates the person key and retires what it derives
      A2.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'd-' + '0'.repeat(32), circleIds: [GROUP] }),
      A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: 'member' }),
    ]);
    await new Promise((r) => setTimeout(r, 1500));
    A2._routerRef.fn = prior;
    expect(cer?.ok, JSON.stringify(cer)).toBe(true);
    expect(role?.error ?? null, JSON.stringify(role)).toBeNull();
    expect(signedByBox(), 'the box signed the ceremony\'s statements itself').toBe(boxBefore);
    await new Promise((r) => setTimeout(r, 2000));
    const { disputed } = await B.agent.membershipRail.readVerified(GROUP);
    expect([...disputed], 'the ceremony forked Anna\'s key').not.toContain(A.pubKey);
  }, 90_000);

  it('the POINT is off: the box\'s act is held for it, and lands — signed by the point — when it is back', async () => {
    const roleOn = async (node, webid) => (((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).find((m) => m.webid === webid)?.role ?? null);
    const signedByBox = () => (A2.agent.membershipRail.storedStatements(GROUP) ?? []).length;
    const boxBefore = signedByBox();
    const want = (await roleOn(B, C.pubKey)) === 'admin' ? 'member' : 'admin';
    await A.agent.sa.relay.disconnect();
    const r = await A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: want });
    expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
    await new Promise((res) => setTimeout(res, 1500));
    expect(await roleOn(B, C.pubKey), 'nothing lands while the point is off').not.toBe(want);
    await A.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => A._routerRef.fn?.(env), awaitRelayReady: true });
    await bindCircleAddresses([A], GROUP);
    expect(await until(async () => ((await roleOn(B, C.pubKey)) === want ? true : null), { timeout: 30000, step: 300 }),
      'the held act never landed once the point was back').toBe(true);
    expect(signedByBox(), 'the box signed it itself').toBe(boxBefore);
    const { disputed } = await B.agent.membershipRail.readVerified(GROUP);
    expect([...disputed]).not.toContain(A.pubKey);
  }, 120_000);
});