/**
 * Joining, three devices: an offline admin, a provable "same person as over there", and the
 * fresh-key default that must stay unlinkable.
 *
 * Three scenarios over REAL agents on a shared in-process bus (`pairRealAgents.js` — the production
 * join path end-to-end: invite → peer redeem → membership trail → the joiner's own mirror):
 *
 *   1. The admin is OFFLINE when a joiner redeems. The join must fail HONESTLY (a typed
 *      admin-unreachable, not a fake success and not a silent nothing), succeed on retry once the
 *      admin returns, and a further retry must not mint a second membership — the roster holds one
 *      row per person however many times the redeem arrives.
 *   2. A joiner CONTINUES AS AN EXISTING SELF: they present the per-circle key they already use in
 *      another circle, with a signing proof. The admin records that address on the roster row —
 *      but only because the proof VERIFIES; the same presentation with a forged proof must be
 *      dropped (join still succeeds, row carries no address) — an address on a roster is a claim
 *      someone proved, never a claim someone merely made.
 *   3. The DEFAULT join presents a FRESH key. The new circle's roster must carry no trace of the
 *      joiner's other circle's address — the cross-circle correlator must not exist on the admin's
 *      device at all, because unlinkability that depends on nobody LOOKING is not unlinkability.
 *
 * Cast: Anna (admin of both circles) · Bram (bystander member — the person who must never be
 * disturbed and never learn anything extra) · Cato (the joiner making the choices).
 */
import { describe, it, expect, afterAll } from 'vitest';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle,
  until, teardown, goOffline, goOnline,
} from '../support/pairRealAgents.js';
import { joinCircleFromInvite, buildCircleInviteUri } from '../../src/v2/circleInvite.js';

const rosterOf = async (node, groupId) => {
  const r = await node.agent.callSkill('stoop', 'listGroupMembers', { groupId });
  return Array.isArray(r?.members) ? r.members : [];
};
const rowsFor = (roster, webid) => roster.filter((m) => m?.webid === webid);

describe('joining with three devices — offline admin, provable self-links, fresh-key default', () => {
  let A; let B; let C;

  afterAll(async () => { await teardown(A, B, C); });

  it('boots the trio and seats the bystander', async () => {
    [A, B, C] = await Promise.all([
      bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('C'),
    ]);
    await connectNodesOverBus([A, B, C]);
    await createCircle(A, { groupId: 'circle-x', name: 'Circle X' });
    const joinedB = await joinExistingCircle(A, B, { groupId: 'circle-x', handle: 'bram' });
    expect(joinedB.joined.ok).toBe(true);
  });

  it('an OFFLINE admin refuses honestly; the retry admits; a second retry does not duplicate', async () => {
    // The invite is minted while the admin is still up — the honest failure under test is the
    // admin being unreachable at REDEEM time, not a broken invite.
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => A.agent.callSkill(app, op, args),
      circleId: 'circle-x', adminPeerAddr: A.pubKey,
    });
    expect(invite.uri).toBeTruthy();

    await goOffline(A);
    const whileOffline = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => C.agent.callSkill(app, op, args),
      sendPeerRedeem: C.sendPeerRedeem,
      handle: 'cato',
    });
    // Honest refusal: an error a UI can translate into "the admin seems offline — try again later".
    // A fake `{ok:true}` here would seat Cato on his own device and nowhere else — a phantom member.
    expect(whileOffline.ok).toBeUndefined();
    expect(whileOffline.error, 'an offline admin must surface as an error, not a success').toBeTruthy();
    const rosterDuring = await rosterOf(A, 'circle-x');
    expect(rowsFor(rosterDuring, C.pubKey)).toHaveLength(0);

    await goOnline(A, { announceTo: C });
    const retry = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => C.agent.callSkill(app, op, args),
      sendPeerRedeem: C.sendPeerRedeem,
      handle: 'cato',
    });
    expect(retry.ok, `retry after the admin returned should succeed: ${retry.error ?? ''}`).toBe(true);

    // The same person redeeming AGAIN (an anxious double-tap, a replayed request) must converge on
    // the SAME membership: one row, not two people named cato.
    const again = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => C.agent.callSkill(app, op, args),
      sendPeerRedeem: C.sendPeerRedeem,
      handle: 'cato',
    });
    expect(again.error ?? null, 'a repeat redeem by the same identity must not be refused as a stranger').toBeNull();
    const roster = await rosterOf(A, 'circle-x');
    expect(rowsFor(roster, C.pubKey), 'exactly one membership row for the joiner').toHaveLength(1);
    // The bystander was never disturbed: still exactly one row, still a member.
    expect(rowsFor(roster, B.pubKey)).toHaveLength(1);
  });

  it('continue-as-existing-self records the PROVEN address; a forged proof is dropped', async () => {
    await createCircle(A, { groupId: 'circle-y', name: 'Circle Y' });
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => A.agent.callSkill(app, op, args),
      circleId: 'circle-y', adminPeerAddr: A.pubKey,
    });

    // Cato presents his circle-x self: the same per-circle key he uses there, signed over a
    // challenge that binds it to circle-y. Anyone in both circles can now verify sameness.
    const xAddress = C.agent.circleAddressFor('circle-x');
    expect(xAddress).toBeTruthy();
    const linked = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => C.agent.callSkill(app, op, args),
      sendPeerRedeem: C.sendPeerRedeem,
      handle: 'cato',
      linkChoice: 'circle-x',
      circles: [{ id: 'circle-x', name: 'Circle X' }],
      circleAddressFor: (cid) => C.agent.circleAddressFor(cid),
      signCircleLink: (cid, gid, addr) => C.agent.signCircleLink(cid, gid, addr),
    });
    expect(linked.ok, `linked join failed: ${linked.error ?? ''}`).toBe(true);
    await until(async () => rowsFor(await rosterOf(A, 'circle-y'), C.pubKey).length === 1, { timeout: 15_000 });
    const [row] = rowsFor(await rosterOf(A, 'circle-y'), C.pubKey);
    expect(row.circleAddress, 'the proven existing-self address must be on the roster row').toBe(xAddress);
  });

  it('a FORGED self-link proof is dropped — the join stands, the claimed address does not', async () => {
    await createCircle(A, { groupId: 'circle-z', name: 'Circle Z' });
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => A.agent.callSkill(app, op, args),
      circleId: 'circle-z', adminPeerAddr: A.pubKey,
    });
    const forged = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => B.agent.callSkill(app, op, args),
      sendPeerRedeem: B.sendPeerRedeem,
      handle: 'bram',
      linkChoice: 'circle-x',
      circles: [{ id: 'circle-x', name: 'Circle X' }],
      // Bram claims CATO's circle-x address — a co-member who has SEEN an address trying to wear it.
      circleAddressFor: () => C.agent.circleAddressFor('circle-x'),
      // …but he cannot produce Cato's signature, only garbage.
      signCircleLink: () => 'forged-proof',
    });
    expect(forged.ok, 'the join itself may stand — membership was legitimately redeemed').toBe(true);
    await until(async () => rowsFor(await rosterOf(A, 'circle-z'), B.pubKey).length === 1, { timeout: 15_000 });
    const [row] = rowsFor(await rosterOf(A, 'circle-z'), B.pubKey);
    // The forged CLAIM must never be recorded. The row MAY legitimately carry an address anyway:
    // after the join, Bram's own device announces an address it can genuinely sign for — his fresh
    // circle-z one, or (since he chose "continue as my circle-x self") his own circle-x one. Both
    // are proofs he can actually produce; the one thing that must never land is the address he
    // could only STEAL. So the assertion is about signability, not presence.
    const claimed = C.agent.circleAddressFor('circle-x');
    expect(row.circleAddress ?? null, 'an address the joiner cannot sign for must never enter a roster row')
      .not.toBe(claimed);
    if (row.circleAddress != null) {
      expect([B.agent.circleAddressFor('circle-z'), B.agent.circleAddressFor('circle-x')],
        'any recorded address must be one Bram can actually sign for')
        .toContain(row.circleAddress);
    }
  });

  it('the fresh-key default leaves NO cross-circle correlator on the admin device', async () => {
    await createCircle(A, { groupId: 'circle-w', name: 'Circle W' });
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => A.agent.callSkill(app, op, args),
      circleId: 'circle-w', adminPeerAddr: A.pubKey,
    });
    const fresh = await joinCircleFromInvite({
      inviteUri: invite.uri,
      callSkill: (app, op, args) => C.agent.callSkill(app, op, args),
      sendPeerRedeem: C.sendPeerRedeem,
      handle: 'cato',
      // No linkChoice — the default is a fresh per-circle key, and the default is the promise.
      circleAddressFor: (cid) => C.agent.circleAddressFor(cid),
      signCircleLink: (cid, gid, addr) => C.agent.signCircleLink(cid, gid, addr),
    });
    expect(fresh.ok, `fresh join failed: ${fresh.error ?? ''}`).toBe(true);

    const xAddress = C.agent.circleAddressFor('circle-x');
    await until(async () => rowsFor(await rosterOf(A, 'circle-w'), C.pubKey).length === 1, { timeout: 15_000 });
    const [row] = rowsFor(await rosterOf(A, 'circle-w'), C.pubKey);
    // The fresh address is real and is NOT the circle-x one.
    if (row.circleAddress != null) expect(row.circleAddress).not.toBe(xAddress);

    // Stronger than the row: the OTHER circle's address must appear nowhere in this circle's
    // membership trail on the admin's device — not in any field of any row. Unlinkability holds at
    // the data level, not at the courtesy-of-the-renderer level.
    const roster = await rosterOf(A, 'circle-w');
    expect(JSON.stringify(roster)).not.toContain(xAddress);
  });
});
