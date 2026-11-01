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
  let relay; let A; let B; let A2; let C; let logA;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    logA = new EventLog({ initial: [], muted: [] });
    A = await bootRealAgentNode('phone', { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), deviceLog: logA } });
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
    await A2.agent.spinePoint?.requestFromSiblings?.();
    expect(await until(() => (A2.agent.spinePointClaim()?.deviceId === A.agent.spinePointClaim()?.deviceId ? true : null), { timeout: 15000, step: 200 }),
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

  it('the POINT is off: the box\'s act is held for it, and lands — signed by the point — when it is back', async () => {
    const roleOn = async (node, webid) => (((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).find((m) => m.webid === webid)?.role ?? null);
    // what the BOX signs itself (its rail's append), not what it stores — it also stores the point's statement by the fan
    let boxAppends = 0;
    const rail = A2.agent.membershipRail;
    const origAppend = rail.append.bind(rail);
    rail.append = async (...x) => { boxAppends += 1; return origAppend(...x); };
    const want = (await roleOn(B, C.pubKey)) === 'admin' ? 'member' : 'admin';
    await A.agent.sa.relay.disconnect();
    // the point is REALLY off: its socket is closed and the relay has let go of its addresses (the close is async)
    expect(await until(() => (A.agent.sa.relay.connected ? null : true), { timeout: 5000, step: 50 }), 'the phone is still connected').toBe(true);
    await new Promise((res) => setTimeout(res, 800));
    const forwards = [];
    const peer = A2.agent.sa.peer;
    const orig = peer.sendTo.bind(peer);
    peer.sendTo = async (to, env, o) => { const out = await orig(to, env, o); if (env?.subtype === A2.agent.spineActSubtype) forwards.push(out); return out; };
    const r = await A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: want });
    peer.sendTo = orig;
    expect(forwards.length, 'the box forwarded nothing').toBeGreaterThanOrEqual(1);
    // proven OFF: the phone holds no live relay socket while the box acts (the relay takes the act and queues it for the
    // point's device address; "delivered" from the sender's side means the relay accepted it)
    expect((A.agent.sa.relays?.list?.() ?? []).filter((x) => x.connected), 'the phone still has a live socket').toEqual([]);
    expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
    await new Promise((res) => setTimeout(res, 1500));
    expect(await roleOn(B, C.pubKey), 'nothing lands while the point is off').not.toBe(want);
    await A.agent.connectPeerTransport({ relayUrl: relay.url, onPeerMessage: (env) => A._routerRef.fn?.(env), awaitRelayReady: true });
    await bindCircleAddresses([A], GROUP);
    const landed = await until(async () => ((await roleOn(B, C.pubKey)) === want ? true : null), { timeout: 30000, step: 300 });
    expect(landed, 'the held act never landed once the point was back').toBe(true);
    rail.append = origAppend;
    expect(boxAppends, 'the box signed it itself').toBe(0);
    const { disputed } = await B.agent.membershipRail.readVerified(GROUP);
    expect([...disputed]).not.toContain(A.pubKey);
  }, 120_000);
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


  it('an act naming someone else (actor, by, voter or authorRef) is refused by the point — identity comes from the point', async () => {
    let pointAppends = 0;
    const rail = A.agent.membershipRail;
    const origAppend = rail.append.bind(rail);
    rail.append = async (...x) => { pointAppends += 1; return origAppend(...x); };
    const from = A2.agent.ownDeviceAddress('default');
    const base = { kind: 'role', circleId: GROUP, subject: C.pubKey, payload: { role: 'member' } };
    for (const forged of [
      { ...base, actor: B.pubKey },
      { ...base, payload: { ...base.payload, by: B.pubKey } },
      { ...base, payload: { ...base.payload, voter: B.pubKey } },
      { ...base, payload: { ...base.payload, authorRef: B.pubKey } },
    ]) {
      await A.agent.spineActHandler(from, { subtype: A.agent.spineActSubtype, lane: 'membership', act: forged });
    }
    rail.append = origAppend;
    expect(pointAppends, 'the point signed an act that named someone else').toBe(0);
  }, 30_000);

  it('a KEY act from the box: the point grants only a current member, from its own roster — never a key the act brings', async () => {
    const ctl = A.circleControlAgentRouter;
    expect(ctl, 'the harness gives the phone a control agent').toBeTruthy();
    const calls = [];
    const orig = ctl.addMember?.bind(ctl);
    ctl.addMember = async (a) => { calls.push(a); return orig ? orig(a).catch(() => null) : null; };
    const from = A2.agent.ownDeviceAddress('default');
    const send = (act) => A.agent.spineActHandler(from, { subtype: A.agent.spineActSubtype, lane: 'key', act });
    await send({ op: 'add', circleId: GROUP, webId: 'webid:not-a-member' });
    await send({ op: 'add', circleId: GROUP, webId: B.pubKey, publicKey: 'ATTACKER-SEALING-KEY' });
    expect(calls, 'the point granted a non-member or a key the act brought').toEqual([]);
    await send({ op: 'add', circleId: GROUP, webId: B.pubKey });
    ctl.addMember = orig;
    expect(calls.length, 'a current member is granted by the point').toBe(1);
    expect(calls[0].publicKey, 'the sealing key is the point\'s own reading of the roster').toBeTruthy();
    expect(calls[0].publicKey).not.toBe('ATTACKER-SEALING-KEY');
  }, 30_000);

  it('a BAN act names an address: the point bans only an old address on the person\'s own row — never the persona\'s, never another member\'s', async () => {
    const { ownCircleAddressAnnouncementFromSeed } = await import('@onderling/core');
    const ctl = A.circleControlAgentRouter;
    const bans = [];
    const orig = ctl.revokeRecipient?.bind(ctl);
    ctl.revokeRecipient = async (a) => { bans.push(a); return null; };
    // an old device-derived address of the box's, on Anna's own row (a membership from before the switch)
    const old = ownCircleAddressAnnouncementFromSeed({ derivationSeed: A2.agent.persona('default').deviceDerivationSeed, circleId: GROUP, memberWebid: A.pubKey });
    await A.agent.callSkill('pinboard', 'recordCircleAddressAnnouncement', { groupId: GROUP, ...old });
    const from = A2.agent.ownDeviceAddress('default');
    const send = (act) => A.agent.spineActHandler(from, { subtype: A.agent.spineActSubtype, lane: 'key', act });
    await send({ op: 'ban', circleId: GROUP, address: A.agent.circleAddressFor(GROUP) });   // the persona's own
    await send({ op: 'ban', circleId: GROUP, address: B.agent.circleAddressFor(GROUP) });   // another member's
    expect(bans, 'the point banned the persona\'s own address or another member\'s').toEqual([]);
    await send({ op: 'ban', circleId: GROUP, address: old.circleAddress });
    ctl.revokeRecipient = orig;
    expect(bans.length, 'the old address on the person\'s own row is banned').toBe(1);
    expect(bans[0].policy).toBe('ban');
  }, 30_000);

  it('a GOVERNANCE act on the box (a proposal) goes to the point: the point signs it on its own log, the box signs nothing', async () => {
    const { bindCircleGovernance } = await import('../src/v2/governanceAppWiring.js');
    const boxLog = new EventLog({ initial: [], muted: [] });
    const govBox = bindCircleGovernance({
      eventLog: boxLog, callSkill: (...a) => A2.agent.callSkill(...a), getPolicy: async () => ({}), myRef: () => A.pubKey,
      genId: () => `gov-${Math.random().toString(36).slice(2, 8)}`, circleIdentityFor: A2.agent.circleIdentityFor, spineGate: A2.agent.spineGate,
    });
    let boxAppends = 0;
    const orig = govBox.rail.append.bind(govBox.rail);
    govBox.rail.append = async (...x) => { boxAppends += 1; return orig(...x); };
    const govOnPhone = () => logA.query({}).filter((e) => e?.kind === 'governance' || e?.type === 'governance' || e?.payload?.body?.kind === 'propose').length;
    const before = govOnPhone();
    const r = await govBox.propose({ circleId: GROUP, action: 'removeMember', subject: C.pubKey, actor: { ref: A.pubKey } });
    govBox.rail.append = orig;
    expect(boxAppends, 'the box signed a governance statement itself').toBe(0);
    expect(await until(() => (govOnPhone() > before ? true : null), { timeout: 15000, step: 200 }),
      `the point never signed the forwarded proposal (result: ${JSON.stringify(r)})`).toBe(true);
  }, 60_000);
});