/**
 * THE LEAVE FOLLOWS (2026-09-22): a circle left on one device is left on the person's other devices — live, over the
 * own-devices carry, and on connect for a device that slept through it. The sibling's own local leave: the exit
 * marker (`listMyCircles` drops the circle), the registry record off (a restore must not re-open it), presence and
 * bindings gone — and NO second `leave` statement on the circle's lane: the leaving device's already folded the person
 * out everywhere, and a second one would only be refused.
 *
 * The arrangement is the enrol corridor's: B founds three circles, A joins all, A2 is enrolled from A's offer and so is
 * in all three. A leaves X while A2 listens (the live half). A2 goes dark, A leaves Y, A2 comes back and asks its
 * siblings (the offline half). Z is never left: the own-devices carry rides a circle the devices SHARE, so a person
 * whose devices share no circle any more has no carry at all — the design's known edge, and why real devices always
 * share the help circle and their pair circles. Nothing is simulated below the harness: real agents, the real
 * consume, the real carry.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle, bindCircleAddresses, until, teardown,
} from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { stashEnrollOffer, consumeEnrollOffer } from '../../src/v2/enrollOffer.js';
import { leaveCircleLocally } from '../../src/v2/circleMembershipHygiene.js';
import { EventLog } from '../../src/eventLog.js';

const X = 'leave-follows-x'; const Y = 'leave-follows-y'; const Z = 'leave-follows-z';   // Z stays: the sibling carry rides a circle the devices share
const memStorage = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); } }; };
const myCircles = async (n) => (await n.agent.callSkill('stoop', 'listMyCircles', {}))?.circles ?? [];
const registryHas = async (n, cid) => {
  const props = await n.agent.callSkill('agents', 'getProfileProperties', { id: 'default' });
  const map = props?.properties?.circleMemberships?.value ?? props?.properties?.circleMemberships ?? {};
  return !!map?.[cid];
};
const leavesOnLane = (n, cid, subject) => n.agent.membershipRail.storedStatements(cid).filter((s) => s?.body?.kind === 'leave' && s?.body?.subject === subject).length;

describe('a circle left on one device is left on the person\'s others', () => {
  let B; let A; let A2; let bus;
  afterAll(async () => { await teardown(B, A, A2); });

  it('the live half: A leaves X → A2 leaves X too (marker, registry, presence) without a statement of its own; B sees one leave', async () => {
    [B, A] = await Promise.all([
      bootRealAgentNode('B', { taskLane: true }),
      bootRealAgentNode('A', { taskLane: true, agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() } }),
    ]);
    bus = await connectNodesOverBus([B, A]);
    for (const cid of [X, Y, Z]) {
      await createCircle(B, { groupId: cid, name: cid });
      const j = await joinExistingCircle(B, A, { groupId: cid, handle: 'anna' });
      expect(j.joined?.ok, JSON.stringify(j.joined)).toBe(true);
      await bindCircleAddresses([B, A], cid);
      await Promise.all([B, A].map((n) => bindCircleAddressKeysFor({ agent: n.agent, circleId: cid })));
      for (const stmt of B.agent.membershipRail.storedStatements(cid)) await A.agent.membershipRail.ingest(cid, stmt);
    }
    // the second device — enrolled from A's offer, in all three circles (the enrol corridor, as the shells run it)
    const built = await A.agent.callSkill('household', 'buildEnrollOffer', { relayUrl: 'ws://relay.example' });
    expect(built.ok, JSON.stringify(built)).toBe(true);
    const storage = memStorage();
    expect((await stashEnrollOffer(storage, built.uri)).ok).toBe(true);
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() };
    const pre = await bootRealAgentNode('A2-pre', { agentOpts: vaults });
    const phrase = (await A.agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic;
    expect((await pre.agent.callSkill('household', 'enrollDevice', { mnemonic: phrase, label: 'tablet' })).ok).toBe(true);
    await teardown(pre);
    A2 = await bootRealAgentNode('A2', { taskLane: true, agentOpts: { ...vaults, deviceLog: new EventLog({ initial: [], muted: [] }) } });
    expect(A2.pubKey).toBe(A.pubKey);
    const tx = new InternalTransport(bus, A2.pubKey);
    await A2.agent.sa.addSecureTransport('relay', tx);
    A2._busTransport = tx;
    await bindCircleAddresses([A2], X, Y, Z);
    // The consume, as the shells run it once per boot — and, as the shells do on the NEXT boot when a seed did not
    // come in time (a loaded machine, three circles × a 10 s wait), once more from the retained stash.
    const consume = () => consumeEnrollOffer({
      agent: A2.agent, callSkill: (app, op, args) => A2.agent.callSkill(app, op, args),
      sendPeerMessage: (to, payload, opts) => A2.agent.sendPeerMessage(to, payload, opts), storage,
    });
    let consumed = await consume();
    if (!consumed.cleared) consumed = await consume();
    expect(consumed.cleared, JSON.stringify(consumed)).toBe(true);
    expect(await myCircles(A2)).toEqual(expect.arrayContaining([X, Y, Z]));
    // the siblings know each other (A's row holds A2's address) before the carry is asked to reach A2
    const known = await until(async () => {
      const r = await A.agent.callSkill('stoop', 'listGroupMembers', { groupId: X });
      return (r?.members ?? []).find((m) => m.webid === A.pubKey)?.circleAddresses?.includes(A2.agent.circleAddressFor(X)) ? true : null;
    }, { timeout: 15000, step: 100 });
    expect(known).toBe(true);

    // ── A LEAVES X — the shells' shared op ──────────────────────────────────────────────────────────
    const left = await leaveCircleLocally({ agent: A.agent, callSkill: (app, op, args) => A.agent.callSkill(app, op, args), circleId: X });
    expect(left.ok, JSON.stringify(left)).toBe(true);
    expect(await myCircles(A), 'A dropped X').not.toContain(X);
    expect(await registryHas(A, X), 'A\'s registry record for X is gone (a restore must not re-open it)').toBe(false);
    expect(await registryHas(A, Y), '…and Y\'s stays').toBe(true);

    // A2 FOLLOWS: X leaves its list, its registry, its rosters — and it says nothing on the lane
    const followed = await until(async () => ((await myCircles(A2)).includes(X) ? null : true), { timeout: 20000, step: 250 });
    expect(followed, 'A2 never left X').toBe(true);
    expect(await registryHas(A2, X)).toBe(false);
    expect(await myCircles(A2), 'A2 is still in Y').toContain(Y);
    // B folded exactly ONE leave for A in X — the leaving device's; the follower added none
    const bSees = await until(async () => (leavesOnLane(B, X, A.pubKey) >= 1 ? true : null), { timeout: 15000, step: 250 });
    expect(bSees, `B never folded A's leave in X — A holds ${leavesOnLane(A, X, A.pubKey)} leave(s) for itself; A2 holds ${leavesOnLane(A2, X, A.pubKey)}; B's X lane: ${JSON.stringify(B.agent.membershipRail.storedStatements(X).map((st) => [st?.body?.kind, String(st?.body?.subject).slice(0, 8)]))}`).toBe(true);
    await new Promise((r) => { setTimeout(r, 1500); });
    expect(leavesOnLane(B, X, A.pubKey), 'one leave, not two').toBe(1);
    expect(leavesOnLane(A2, X, A.pubKey) <= 1, 'the follower holds at most the sibling\'s statement').toBe(true);
    const bRoster = (await B.agent.callSkill('stoop', 'listGroupMembers', { groupId: X }))?.members ?? [];
    expect(bRoster.map((m) => m.webid), 'B\'s roster no longer names A').not.toContain(A.pubKey);
  }, 300_000);   // the enrol corridor over three circles, then the leave + the follow — heavy, and heavier on a loaded runner

  it('the offline half: A2 is dark while A leaves Y; on connect A2 asks its siblings and leaves Y too', async () => {
    const live = A2._routerRef.fn;
    A2._routerRef.fn = () => undefined;   // dark: inbound dropped, as for a phone that is off
    const left = await leaveCircleLocally({ agent: A.agent, callSkill: (app, op, args) => A.agent.callSkill(app, op, args), circleId: Y });
    expect(left.ok, JSON.stringify(left)).toBe(true);
    await new Promise((r) => { setTimeout(r, 2000); });
    expect(await myCircles(A2), 'dark: A2 still holds Y').toContain(Y);
    A2._routerRef.fn = live;               // back
    expect((await A2.agent.circleFollowSync.requestFromSiblings()).requested).toBeGreaterThan(0);
    const followed = await until(async () => ((await myCircles(A2)).includes(Y) ? null : true), { timeout: 20000, step: 250 });
    expect(followed, 'A2 never left Y after asking its siblings').toBe(true);
    expect(await registryHas(A2, Y)).toBe(false);
    expect(await myCircles(A2), 'Z stays on both').toContain(Z);
    expect(leavesOnLane(B, Y, A.pubKey), 'one leave in Y too').toBe(1);
  }, 120_000);
});
