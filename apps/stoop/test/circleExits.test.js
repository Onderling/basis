/**
 * B4 — removal is PER CIRCLE, and leaving prunes.
 *
 * Two circles, two members, one substrate. What this file exists to catch is the shape of the bug it
 * replaces: removal used to delete the member from the ONE global `MemberMap`, so dropping someone
 * from circle A dropped them from circle B as well — and the `group-removal` item that was supposed
 * to be the record of the act was read by nothing, so circle A's own roster did not change at all.
 * Global where it should have been local; inert where it should have bitten.
 *
 * Every assertion below is therefore a PAIR: what changed in circle A, and what did NOT change in
 * circle B. A test that only checked A would have passed against the old code for the wrong reason.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighborhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BRAM  = 'https://id.example/bram';
const CATO  = 'https://id.example/cato';

const A = 'buurt-a';
const B = 'koor-b';

async function callSkill(agent, skillId, args, fromWebid = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

/** One substrate holding TWO circles, with the same person in both — the arrangement the bug needed. */
async function buildTwoCircles() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: A, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
  });
  await bundle.offeringMatch.start();
  const rules = { purpose: 'test' };
  for (const groupId of [A, B]) {
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId, name: groupId, rules });
    expect(r.groupId).toBe(groupId);
    // Bram joins BOTH circles; cato joins A only.
    await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId, code: r.code, requesterWebid: BRAM }, ADMIN);
  }
  const codeA = await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: A });
  await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
    { groupId: A, code: codeA.code, requesterWebid: CATO }, ADMIN);
  return bundle;
}

const webidsIn = async (bundle, groupId, from = ADMIN) =>
  (await callSkill(bundle.agent, 'listGroupMembers', { groupId }, from)).members.map((m) => m.webid).sort();

describe('B4 — removing a member is per circle', () => {
  it('the two circles start out with the member in BOTH (the control)', async () => {
    const bundle = await buildTwoCircles();
    expect(await webidsIn(bundle, A)).toEqual([ADMIN, BRAM, CATO].sort());
    expect(await webidsIn(bundle, B)).toEqual([ADMIN, BRAM].sort());
  });

  it('removing from circle A drops them from A — the roster actually changes', async () => {
    // The half that was INERT: `group-removal` was written and read by nobody, so this list was
    // unchanged after a removal (the member vanished from the UI only because of the global
    // MemberMap deletion, which is the other half of the bug).
    const bundle = await buildTwoCircles();
    const r = await callSkill(bundle.agent, 'removeMember', { groupId: A, memberWebid: BRAM });
    expect(r.removalId).toBeTruthy();
    expect(await webidsIn(bundle, A)).toEqual([ADMIN, CATO].sort());
  });

  it('…and leaves circle B completely untouched — the whole point', async () => {
    // The half that was GLOBAL. Against the old code this list came back without BRAM.
    const bundle = await buildTwoCircles();
    await callSkill(bundle.agent, 'removeMember', { groupId: A, memberWebid: BRAM });
    expect(await webidsIn(bundle, B)).toEqual([ADMIN, BRAM].sort());
  });

  it('their circle-B row keeps its keys and address — not just their name in a list', async () => {
    // Membership is what the row CARRIES, not whether a webid appears. A removal that stripped the
    // keys from the other circle's row would still break messaging there while passing the check above.
    const bundle = await buildTwoCircles();
    const beforeRows = (await callSkill(bundle.agent, 'listGroupMembers', { groupId: B })).members;
    const before = beforeRows.find((m) => m.webid === BRAM);
    await callSkill(bundle.agent, 'removeMember', { groupId: A, memberWebid: BRAM });
    const after = (await callSkill(bundle.agent, 'listGroupMembers', { groupId: B })).members
      .find((m) => m.webid === BRAM);
    expect(after).toBeTruthy();
    expect(after.pubKey).toBe(before.pubKey);
    expect(after.role).toBe(before.role);
  });

  it('the GLOBAL member cache still resolves them — this is the severed relationship', async () => {
    // The most direct statement of the old bug. `MemberMap.resolveByWebid` is how the chat send path
    // turns a webid into a routable pubKey, for EVERY circle. Removal used to delete the row, so a
    // person removed from circle A became `recipient-pubkey-unknown` in circle B, in a direct
    // message, and everywhere else — a relationship quietly severed by tidying up one circle.
    const bundle = await buildTwoCircles();
    expect((await bundle.members.resolveByWebid(BRAM))?.pubKey).toBeTruthy();
    await callSkill(bundle.agent, 'removeMember', { groupId: A, memberWebid: BRAM });
    const stillKnown = await bundle.members.resolveByWebid(BRAM);
    expect(stillKnown, 'removed from one circle, still a person this device knows').toBeTruthy();
    expect(stillKnown.pubKey, 'and still routable').toBeTruthy();
  });

  it('the FAN-OUT roster for circle A drops them, and circle B\'s does not', async () => {
    // `listGroupRoster` is what household-sync pairing and the address fan read. Leaving it stale
    // would mean a removed member kept being re-added as a peer on every circle-open.
    const bundle = await buildTwoCircles();
    await callSkill(bundle.agent, 'removeMember', { groupId: A, memberWebid: BRAM });
    const rosterA = await callSkill(bundle.agent, 'listGroupRoster', { groupId: A });
    const rosterB = await callSkill(bundle.agent, 'listGroupRoster', { groupId: B });
    expect(rosterA.members.map((m) => m.addr)).not.toContain(BRAM);
    expect(rosterB.members.map((m) => m.addr)).toContain(BRAM);
  });

  it('removal by stableId records a webid, so it is projectable at all', async () => {
    // A removal that names only a stableId used to write a row the projection could not match, i.e.
    // an audit entry with no effect. The skill resolves the webid before writing.
    const id = await AgentIdentity.generate(new VaultMemory());
    const bundle = await createNeighborhoodAgent({
      identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
      offeringMatch: { group: A, localActor: ADMIN, peers: [] },
      members: [{ webid: ADMIN, role: 'admin' }, { webid: BRAM, role: 'member', stableId: 'sid-bram' }],
    });
    await bundle.offeringMatch.start();
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: A, name: A, rules: {} });
    await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: A, code: created.code, requesterWebid: BRAM }, ADMIN);
    const r = await callSkill(bundle.agent, 'removeMember', { groupId: A, memberStableId: 'sid-bram' });
    const item = await bundle.itemStore.getById(r.removalId);
    expect(item.source.memberWebid).toBe(BRAM);
    expect(item.source.memberStableId).toBe('sid-bram');
    expect(await webidsIn(bundle, A)).not.toContain(BRAM);
  });

  it('a re-join re-admits them: removal is a fact with a date, not a life sentence', async () => {
    const bundle = await buildTwoCircles();
    await callSkill(bundle.agent, 'removeMember', { groupId: A, memberWebid: BRAM });
    expect(await webidsIn(bundle, A)).not.toContain(BRAM);
    // A fresh invite, redeemed after the removal.
    const rot = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: A });
    const again = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: A, code: rot.code, requesterWebid: BRAM }, ADMIN);
    expect(again.redemptionId).toBeTruthy();
    expect(await webidsIn(bundle, A)).toContain(BRAM);
  });
});

describe('B4 — leaving a circle prunes it on the leaver\'s side', () => {
  it('after leaving circle A, that circle\'s roster no longer names the leaver', async () => {
    const bundle = await buildTwoCircles();
    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: A }, BRAM);
    expect(r.leaveMarkerId).toBeTruthy();
    expect(await webidsIn(bundle, A)).not.toContain(BRAM);
  });

  it('…and circle B, which they did not leave, still has them', async () => {
    const bundle = await buildTwoCircles();
    await callSkill(bundle.agent, 'leaveGroup', { groupId: A }, BRAM);
    expect(await webidsIn(bundle, B)).toContain(BRAM);
  });

  it('a left circle stops being one of "my circles" — so a reboot cannot undo the leave', async () => {
    // `listMyCircles` drives `primeCircleSecurity` and the relay's per-circle address registration.
    // Without this filter the next boot would re-record the authorize snapshot for a circle you left
    // and re-register its address on the relay — silently undoing both halves, one restart later.
    const bundle = await buildTwoCircles();
    const before = (await callSkill(bundle.agent, 'listMyCircles', undefined, BRAM)).buurts.sort();
    expect(before).toEqual([A, B].sort());
    await callSkill(bundle.agent, 'leaveGroup', { groupId: A }, BRAM);
    expect((await callSkill(bundle.agent, 'listMyCircles', undefined, BRAM)).buurts).toEqual([B]);
    // …and the admin, who left nothing, still has both.
    expect((await callSkill(bundle.agent, 'listMyCircles', undefined, ADMIN)).buurts.sort())
      .toEqual([A, B].sort());
  });

  it('leaving is not removal: nobody else is affected in the circle that was left', async () => {
    const bundle = await buildTwoCircles();
    await callSkill(bundle.agent, 'leaveGroup', { groupId: A }, BRAM);
    expect(await webidsIn(bundle, A)).toEqual([ADMIN, CATO].sort());
  });
});

describe('B4 — a circle with no redemption trail is still per-circle', () => {
  it('the legacy MemberMap fallback honours this circle\'s removals', async () => {
    // A seeded single-buurt roster from before code-minting has no trail to project from, so the
    // roster falls back to the whole MemberMap. That fallback used to be the ONLY place removal had
    // an effect — via the global cache deletion, which was the bug. It is now exit-filtered per
    // circle instead, so removal still works here and still cannot reach another circle.
    const id = await AgentIdentity.generate(new VaultMemory());
    const bundle = await createNeighborhoodAgent({
      identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
      offeringMatch: { group: 'legacy-buurt', localActor: ADMIN, peers: [] },
      members: [{ webid: ADMIN, role: 'admin' }, { webid: BRAM, role: 'member' }, { webid: CATO, role: 'member' }],
    });
    await bundle.offeringMatch.start();
    expect(await webidsIn(bundle, 'legacy-buurt')).toEqual([ADMIN, BRAM, CATO].sort());
    await callSkill(bundle.agent, 'removeMember', { groupId: 'legacy-buurt', memberWebid: BRAM });
    expect(await webidsIn(bundle, 'legacy-buurt')).toEqual([ADMIN, CATO].sort());
    // …and a DIFFERENT legacy group on the same device is untouched.
    expect(await webidsIn(bundle, 'other-legacy-buurt')).toEqual([ADMIN, BRAM, CATO].sort());
  });
});
