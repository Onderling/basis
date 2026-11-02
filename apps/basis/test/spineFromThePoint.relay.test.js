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
import { makeMembershipPeerHandler, MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES } from '../src/v2/membershipRail.js';
import { EventLog } from '../src/eventLog.js';
import { SPINE_POINT_SUBTYPES } from '../src/v2/primaryDevice.js';

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
    // what reaches Bea, and what her rail says to it — a failure names whether a statement never arrived or was refused
    const beaIngest = B.agent.membershipRail.ingest.bind(B.agent.membershipRail);
    B.agent.membershipRail.ingest = async (cid, st) => {
      const res = await beaIngest(cid, st);
      beaHeard.push(`${String(st?.body?.hash ?? '').slice(0, 8)}:${res?.ok ? (res.existed ? 'dup' : 'ok') : `refused(${res?.reason ?? '?'})`}`);
      return res;
    };
  }, 240_000);
  const beaHeard = [];   // filled by the ingest recorder in beforeAll
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

  it('THE OUTBOX: an act lost on the way is re-sent until the point acks it — and signed once, however often it arrives', async () => {
    const roleOn = async (node, webid) => (((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).find((m) => m.webid === webid)?.role ?? null);
    const want = (await roleOn(B, C.pubKey)) === 'admin' ? 'member' : 'admin';
    // the point loses the first act that reaches it
    const prior = A._routerRef.fn;
    let dropped = 0;
    A._routerRef.fn = (env) => { if (env?.payload?.subtype === A.agent.spineActSubtype && dropped === 0) { dropped += 1; return undefined; } return prior?.(env); };
    const r = await A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: want });
    expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
    expect(await until(() => (dropped === 1 ? true : null), { timeout: 10000, step: 100 }), 'the act never reached the point at all').toBe(true);
    A._routerRef.fn = prior;
    await new Promise((res) => setTimeout(res, 1000));
    expect(await roleOn(B, C.pubKey), 'the lost act landed anyway').not.toBe(want);
    const first = await A2.agent.resendSpineOutbox();
    expect(first.resent, 'the box had nothing waiting').toBeGreaterThanOrEqual(1);
    const landedR = await until(async () => ((await roleOn(B, C.pubKey)) === want ? true : null), { timeout: 20000, step: 300 });
    const cOnA = (((await A.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).map((m) => String(m.webid).slice(0, 6)));
    expect(landedR, `the re-sent act never landed — the point shows ${await roleOn(A, C.pubKey)}, Bea ${await roleOn(B, C.pubKey)}, wanted ${want}; the point's roster ${JSON.stringify(cOnA)}, Cas ${String(C.pubKey).slice(0, 6)}, B ${String(B.pubKey).slice(0, 6)}, Anna ${String(A.pubKey).slice(0, 6)}`).toBe(true);
    // the ack cleared it: nothing goes again
    expect(await until(async () => (((await A2.agent.resendSpineOutbox()).resent === 0) ? true : null), { timeout: 10000, step: 300 }), 'the outbox kept an acked act').toBe(true);
  }, 90_000);

  it('THE OUTBOX IS BOUNDED: an act never acked is re-sent for the window, shows as waiting past a day, and past the window is dropped and reported as not sent', async () => {
    // A phone point can be off overnight or for a trip: the act keeps going for the whole window. Past it, it stops, and
    // the person is told it was not sent rather than left to think it will still land.
    const prior = A._routerRef.fn;
    A._routerRef.fn = (env) => (env?.payload?.subtype === A.agent.spineActSubtype ? undefined : prior?.(env));
    const DAY = 24 * 3600_000;
    try {
      const r = await A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: C.pubKey, role: 'member' });
      expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
      expect(r?.forwarded, 'the box signed the change itself').toBe(true);
      const now = await A2.agent.spineOutboxWaiting();
      expect(now.waiting.length, 'the lost act is not waiting').toBeGreaterThanOrEqual(1);
      expect(now.waiting.every((w) => w.overDay === false), 'a fresh act already reads as over a day').toBe(true);
      const op = await A2.agent.callSkill('household', 'ownSpineOutbox', {});
      expect(op?.ok && op.waiting >= 1 && op.overDay === 0 && op.unsent === 0, `the panel's op says ${JSON.stringify(op)}`).toBe(true);
      expect((await A2.agent.resendSpineOutbox()).resent, 'inside the window the act is re-sent').toBeGreaterThanOrEqual(1);
      expect((await A2.agent.resendSpineOutbox({ now: Date.now() + 6 * DAY })).resent, 'six days on, the act no longer goes').toBeGreaterThanOrEqual(1);
      expect((await A2.agent.spineOutboxWaiting({ now: Date.now() + 2 * DAY })).waiting.every((w) => w.overDay), 'past a day the act does not say so').toBe(true);
      // past the window: dropped from the outbox, and listed as not sent
      const past = Date.now() + 8 * DAY;
      const before = (await A2.agent.spineOutboxWaiting()).waiting.filter((w) => !w.acked).length;
      const peek = await A2.agent.spineOutboxWaiting({ now: past });
      expect(peek.waiting.length, 'past the window the act still waits').toBe(0);
      expect(peek.unsent.length, 'past the window the act is not reported as not sent').toBe(before);
      expect((await A2.agent.resendSpineOutbox({ now: past })).resent, 'past the window the act went again').toBe(0);
    } finally { A._routerRef.fn = prior; }
  }, 60_000);

  it('a re-sent act whose ack was lost is signed once (the point dedupes by act id)', async () => {
    let pointAppends = 0;
    const rail = A.agent.membershipRail;
    const origAppend = rail.append.bind(rail);
    rail.append = async (...x) => { pointAppends += 1; return origAppend(...x); };
    const from = A2.agent.ownDeviceAddress('default');
    const act = { kind: 'role', circleId: GROUP, subject: C.pubKey, payload: { role: 'member' }, actor: A.pubKey };
    const msg = { subtype: A.agent.spineActSubtype, lane: 'membership', act, actId: 'act-dedupe-test-1' };
    await A.agent.spineActHandler(from, msg);
    await A.agent.spineActHandler(from, msg);
    rail.append = origAppend;
    expect(pointAppends, 'the point signed one act twice').toBe(1);
  }, 30_000);
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


  // (last: an admin's proposal to remove Cas passes at once under the test's empty policy, and evicts Cas)
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


  // ── A NEW POINT CATCHES UP FIRST ── (after every case above: these move the point)
  const roleOnAt = async (node, webid) => (((await node.agent.callSkill('pinboard', 'listGroupMembers', { groupId: GROUP }))?.members ?? []).find((m) => m.webid === webid)?.role ?? null);
  const ownRoleStatements = (node) => (node.agent.membershipRail.storedStatements(GROUP) ?? [])
    .filter((x) => x?.body?.author === A.agent.circleAddressFor(GROUP) && x.body.kind === 'role' && x.body.subject === B.pubKey);

  it('the point MOVES to the box before the phone\'s newest statement reached it: the box catches up first, and its first statement chains on that one — no fork', async () => {
    const prior = A2._routerRef.fn;
    // the box hears no live membership fan or carry: only a catch-up can bring it the phone's newest statement
    A2._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_BROADCAST ? undefined : prior?.(env));
    try {
      const want1 = (await roleOnAt(A, B.pubKey)) === 'admin' ? 'member' : 'admin';
      expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: want1 }))?.error ?? null).toBeNull();
      const s1 = ownRoleStatements(A).find((x) => x.body.payload?.role === want1)?.body?.hash;
      expect(s1, 'the phone signed nothing').toBeTruthy();
      expect(ownRoleStatements(A2).some((x) => x.body.hash === s1), 'the box already held the phone\'s newest statement — the case proves nothing').toBe(false);
      expect(A2.agent.spinePointClaim()?.deviceId, 'the box did not know the phone was the point').toBe(A.agent.spinePointClaim()?.deviceId);
      const moved = await A2.agent.claimPrimaryDevice();
      expect(moved?.point?.ok, JSON.stringify(moved?.point)).toBe(true);
      const want2 = want1 === 'admin' ? 'member' : 'admin';
      const r2 = await A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: want2 });
      expect(r2?.error ?? null, JSON.stringify(r2)).toBeNull();
      const s2 = await until(() => ownRoleStatements(A2).find((x) => x.body.payload?.role === want2) ?? null, { timeout: 20000, step: 200 });
      expect(s2, `the box never signed — closed: ${JSON.stringify(A2.agent.spineClosedCircles())}`).toBeTruthy();
      expect(s2.body.parentHash, 'the box signed off its stale head: a fork on the shared key').toBe(s1);
      const beaSaw = await until(async () => ((await roleOnAt(B, B.pubKey)) === want2 ? true : null), { timeout: 20000, step: 200 });
      // where it stopped, when it did: did the statement reach Bea at all, and if so what her fold made of it
      const why = async () => {
        const held = B.agent.membershipRail.storedStatements(GROUP) ?? [];
        const mineThere = held.filter((x) => x?.body?.author === s2.body.author).map((x) => `${x.body.hash.slice(0, 8)}<-${String(x.body.parentHash ?? '').slice(0, 8)}`);
        let disputed = null; try { disputed = [...((await B.agent.membershipRail.readVerified?.(GROUP))?.disputed ?? [])].map((r) => String(r).slice(0, 8)); } catch (e) { disputed = `err ${e.message}`; }
        return JSON.stringify({ s2: `${s2.body.hash.slice(0, 8)}<-${String(s2.body.parentHash).slice(0, 8)}`, author: String(s2.body.author).slice(0, 8), beaHoldsS2: held.some((x) => x?.body?.hash === s2.body.hash), beaHoldsS1: held.some((x) => x?.body?.hash === s1), beaChainOfThatAuthor: mineThere, disputed, beaRole: await roleOnAt(B, B.pubKey), beaHeardLast: beaHeard.slice(-8), boxAddr: String(A2.agent.circleAddressFor(GROUP)).slice(0, 8), phoneAddr: String(A.agent.circleAddressFor(GROUP)).slice(0, 8) });
      };
      expect(beaSaw, `Bea never saw the box's change — ${beaSaw ? '' : await why()}`).toBe(true);
      expect([...(await B.agent.membershipRail.readVerified(GROUP)).disputed], 'Anna forked her own key').not.toContain(A.pubKey);
    } finally { A2._routerRef.fn = prior; }
  }, 90_000);

  it('the point moves while nobody can answer: the act WAITS (nothing signed, past the time-out too), and lands chained on the head once someone answers', async () => {
    const prior = A._routerRef.fn;
    // the phone takes the point back while no catch-up answer can reach it (the members and the box all "away")
    A._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_CATCHUP_SUBTYPES.batch || env?.payload?.subtype === MEMBERSHIP_BROADCAST ? undefined : prior?.(env));
    let released = false;
    try {
      // the tip of Anna's chain as the box (the previous point) holds it: her statement no other of hers names as parent
      const mine = (A2.agent.membershipRail.storedStatements(GROUP) ?? []).filter((x) => x?.body?.author === A.agent.circleAddressFor(GROUP));
      const named = new Set(mine.map((x) => x.body.parentHash).filter(Boolean));
      const tips = mine.filter((x) => !named.has(x.body.hash)).map((x) => x.body.hash);
      expect(tips.length, 'Anna\'s chain on the box is already forked').toBe(1);
      const head = tips[0];
      const moved = await A.agent.claimPrimaryDevice();
      expect(moved?.point?.ok, JSON.stringify(moved?.point)).toBe(true);
      expect(await until(() => (A.agent.spineClosedCircles().includes(GROUP) ? true : null), { timeout: 10000, step: 100 }), 'the phone never closed the circle').toBe(true);
      const before = ownRoleStatements(A).length;
      const want = (await roleOnAt(A, B.pubKey)) === 'admin' ? 'member' : 'admin';
      const r = await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: want });
      expect(r?.waitingCatchUp, `the act did not say it waits: ${JSON.stringify(r)}`).toBe(true);
      await new Promise((res) => setTimeout(res, 17_000));   // past the time-out: members exist, so it must not release
      expect(A.agent.spineClosedCircles(), 'the time-out released a circle that has members to fork against').toContain(GROUP);
      expect(ownRoleStatements(A).length, 'the phone signed blind').toBe(before);
      // someone answers
      A._routerRef.fn = prior;
      released = true;
      await A.agent.spineCatchUpAgain();
      const s = await until(() => ownRoleStatements(A).find((x) => x.body.payload?.role === want) ?? null, { timeout: 20000, step: 200 });
      expect(s, 'the waiting act never landed').toBeTruthy();
      expect(s.body.parentHash, 'it did not chain on the head the box had signed').toBe(head);
      expect(await until(async () => ((await roleOnAt(B, B.pubKey)) === want ? true : null), { timeout: 20000, step: 200 }), 'Bea never saw the change').toBe(true);
      expect([...(await B.agent.membershipRail.readVerified(GROUP)).disputed], 'Anna forked her own key').not.toContain(A.pubKey);
    } finally { if (!released) A._routerRef.fn = prior; }
  }, 90_000);

  it('a device whose claim names a point it cannot place yet signs NOTHING itself: the act waits, and goes to the point once it can be placed', async () => {
    // the newcomer that learned the claim before the device map: a non-point device signing on the shared key is the fork
    const carry = A2.agent.spinePoint.handlers[SPINE_POINT_SUBTYPES.carry];
    const fromPhone = A.agent.ownDeviceAddress('default');
    const phoneClaim = A.agent.spinePointClaim();
    await carry(fromPhone, { subtype: SPINE_POINT_SUBTYPES.carry, deviceId: 'd-' + 'f'.repeat(32), at: (phoneClaim?.at ?? Date.now()) + 1 });
    expect(A2.agent.spinePointClaim()?.deviceId, 'the box did not take the claim').toBe('d-' + 'f'.repeat(32));
    const signedOnBox = () => ownRoleStatements(A2).length;
    const before = signedOnBox();
    const want = (await roleOnAt(A2, B.pubKey)) === 'admin' ? 'member' : 'admin';
    const r = await A2.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: want });
    expect(r?.error ?? null, JSON.stringify(r)).toBeNull();
    expect(r?.forwarded, `the box did not hand the act on: ${JSON.stringify(r)}`).toBe(true);
    await new Promise((res) => setTimeout(res, 1500));
    expect(signedOnBox(), 'the box signed on the shared key while the point was elsewhere').toBe(before);
    // the point becomes placeable: the claim names the phone again
    await carry(fromPhone, { subtype: SPINE_POINT_SUBTYPES.carry, deviceId: phoneClaim.deviceId, at: (phoneClaim?.at ?? Date.now()) + 2 });
    expect(await until(async () => ((await roleOnAt(B, B.pubKey)) === want ? true : null), { timeout: 20000, step: 200 }), 'the waiting act never reached the point').toBe(true);
    expect([...(await B.agent.membershipRail.readVerified(GROUP)).disputed], 'Anna forked her own key').not.toContain(A.pubKey);
  }, 60_000);

  it('a CEREMONY run on a point that has not caught up waits like any other act: its statements chain on the newest head — no fork', async () => {
    const prior = A2._routerRef.fn;
    A2._routerRef.fn = (env) => (env?.payload?.subtype === MEMBERSHIP_BROADCAST ? undefined : prior?.(env));
    try {
      const want = (await roleOnAt(A, B.pubKey)) === 'admin' ? 'member' : 'admin';
      expect((await A.agent.callSkill('pinboard', 'setMemberRole', { groupId: GROUP, memberWebid: B.pubKey, role: want }))?.error ?? null).toBeNull();
      const s1 = ownRoleStatements(A).find((x) => x.body.payload?.role === want)?.body?.hash;
      expect(ownRoleStatements(A2).some((x) => x.body.hash === s1), 'the box already held the newest statement').toBe(false);
      // Anna's chain as it is NOW (the ceremony re-keys her to a new address; this one is the chain that must not fork)
      const oldAuthor = A.agent.circleAddressFor(GROUP);
      const mine = () => (A2.agent.membershipRail.storedStatements(GROUP) ?? []).filter((x) => x?.body?.author === oldAuthor);
      const all = () => (A2.agent.membershipRail.storedStatements(GROUP) ?? []);
      const revokesBefore = all().filter((x) => x.body.kind === 'address-revoke').length;
      expect((await A2.agent.claimPrimaryDevice())?.point?.ok).toBe(true);
      const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
      const r = await A2.agent.callSkill('household', 'revokeDevice', { mnemonic: phrase, deviceId: 'd-' + 'c'.repeat(32), circleIds: [GROUP] });
      expect(r?.ok, JSON.stringify(r)).toBe(true);
      const tipsOf = (list) => { const named = new Set(list.map((x) => x.body.parentHash).filter(Boolean)); return list.filter((x) => !named.has(x.body.hash)); };
      expect(await until(() => (all().filter((x) => x.body.kind === 'address-revoke').length > revokesBefore ? true : null), { timeout: 20000, step: 200 }),
        'the ceremony\'s statement never signed').toBe(true);
      expect(all().some((x) => x.body.hash === s1), 'the box signed without catching up first').toBe(true);
      expect(tipsOf(mine()).length, 'Anna\'s chain on the box forked').toBe(1);
      await new Promise((res) => setTimeout(res, 1500));
      expect([...(await B.agent.membershipRail.readVerified(GROUP)).disputed], 'Anna forked her own key').not.toContain(A.pubKey);
    } finally { A2._routerRef.fn = prior; }
  }, 90_000);
});