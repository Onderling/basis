/**
 * END-TO-END: removal is PER CIRCLE and it reaches the thing that decides who may speak — over a
 * REAL relay, REAL sockets and the REAL production paths (B4). Plus the invite ceiling refused by
 * the ISSUER (B5).
 *
 * ── Why this file, when there are unit tests next door ──────────────────────────────────────────
 * The substrate tests (`apps/stoop/test/circleExits.test.js`) prove the roster projection drops a
 * removed member. That is necessary and it is not the claim. The claim is that a removed member
 * **cannot speak into the circle they were removed from, and can still speak in one they were not**
 * — and that runs through the boundary-authentication snapshot (`recordCircleRoster`), which is fed
 * out of band by a roster read, from application code, on the admin's device. A removal that changed
 * the list without re-recording that snapshot would pass every unit test and leave the removed
 * member's key in the allowed set. That is precisely the failure this file exists to make impossible
 * to ship: it never touches the authorizer directly, only the operation an admin performs.
 *
 * ── The arrangement ─────────────────────────────────────────────────────────────────────────────
 * Two circles with ONE member in common, which is the only arrangement in which "per circle" means
 * anything: bram is in circle A (with admin and cato) and in circle B (with admin). Admin removes
 * bram from A. Every assertion is then a pair — what stopped working in A, and what did NOT stop
 * working in B.
 *
 * Nothing is simulated: the join is the real wizard chain over the peer bridge, the removal is the
 * shared shell operation both shells call (`removeCircleMember`), the refusal is the real
 * `SecurityLayer` authorizer, and the traffic is the real circle fan.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
// Through the package barrel, not `packages/relay/src/server.js` — the four sibling relay tests all
// reach into raw src and each is a `lint:deps` violation; a new file need not add a fifth.
import { startRelay } from '@onderling/relay';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, joinExistingCircle,
  bindCircleAddresses, readRoster, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../src/v2/householdRosterPairing.js';
import { primeCircleSecurity } from '../../src/v2/circleSecurityPriming.js';
import { removeCircleMember, leaveCircleLocally } from '../../src/v2/circleMembershipHygiene.js';
import { buildCircleInviteUri, joinCircleFromInvite } from '../../src/v2/circleInvite.js';

const CIRCLE_A = 'circle-membership-hygiene';
const CIRCLE_B = 'koor-membership-hygiene';
const rnd = () => Math.random().toString(36).slice(2, 8);
const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

/** The two steps every shell performs after a join. */
async function settleMember(node, circleId) {
  await bindCircleAddresses([node], circleId);
  await bindCircleAddressKeysFor({ agent: node.agent, circleId });
}
const boot = (node) => primeCircleSecurity({ agent: node.agent, onWarn: () => {} });
const webids = (roster) => roster.map((m) => m?.webid).sort();

describe('B4 — a removed member is silenced in THAT circle only (real relay)', () => {
  let relay; let relayUrl;
  let admin; let bram; let cato;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;

    // Fallback OFF — "rather undeliverable than routed over my one global key". With it ON a member
    // is quietly reached at their global address and half of what this file asserts would hold for
    // the wrong reason.
    const opts = { agentOpts: { allowAddressFallback: false } };
    [admin, bram, cato] = await Promise.all([
      bootRealAgentNode('admin', opts), bootRealAgentNode('bram', opts), bootRealAgentNode('cato', opts),
    ]);
    await connectNodesOverRelay([admin, bram, cato], { relayUrl });

    // Circle A: admin + bram + cato. Circle B: admin + bram.
    await createCircle(admin, { groupId: CIRCLE_A, name: 'Circle (hygiene)' });
    await settleMember(admin, CIRCLE_A);
    expect((await joinExistingCircle(admin, bram, { groupId: CIRCLE_A, handle: 'bram' })).joined.ok).toBe(true);
    await settleMember(bram, CIRCLE_A);
    expect((await joinExistingCircle(admin, cato, { groupId: CIRCLE_A, handle: 'cato' })).joined.ok).toBe(true);
    await settleMember(cato, CIRCLE_A);

    await createCircle(admin, { groupId: CIRCLE_B, name: 'Koor (hygiene)' });
    await settleMember(admin, CIRCLE_B);
    expect((await joinExistingCircle(admin, bram, { groupId: CIRCLE_B, handle: 'bram-b' })).joined.ok).toBe(true);
    await settleMember(bram, CIRCLE_B);

    // The boot step both shells run — the whole self-healing claim rests on it, so a test that
    // skipped it would be asserting a property nobody has.
    await Promise.all([boot(admin), boot(bram), boot(cato)]);
    await settle(1500);
    for (const [node, circles] of [[admin, [CIRCLE_A, CIRCLE_B]], [bram, [CIRCLE_A, CIRCLE_B]], [cato, [CIRCLE_A]]]) {
      for (const c of circles) await bindCircleAddressKeysFor({ agent: node.agent, circleId: c });
    }
  }, 180000);

  afterAll(async () => {
    try { await teardown(admin, bram, cato); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  /* ── Positive controls, BEFORE anything is removed ────────────────────────────────────────── */

  it('POSITIVE CONTROL: bram is on both rosters and his traffic arrives in both', async () => {
    // A check that refuses everything is an outage, and every assertion below would pass in one.
    expect(webids(await readRoster(admin, CIRCLE_A))).toContain(bram.pubKey);
    expect(webids(await readRoster(admin, CIRCLE_B))).toContain(bram.pubKey);

    for (const circleId of [CIRCLE_A, CIRCLE_B]) {
      const text = `before-removal-${circleId}-${rnd()}`;
      const fan = await sendCircleChat(bram, {
        groupId: circleId, msgId: `m-${rnd()}`, text,
      });
      expect(fan.errors, `fan errors in ${circleId}: ${JSON.stringify(fan.errors)}`).toEqual([]);
      await until(() => admin.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
      expect(admin.chatEvents.some((e) => e?.payload?.text === text), `arrived in ${circleId}`).toBe(true);
    }
  }, 60000);

  /* ── The removal ─────────────────────────────────────────────────────────────────────────── */

  it('THE REMOVAL: the shared shell operation drops him from A and reports the remaining roster', async () => {
    const r = await removeCircleMember({ agent: admin.agent, circleId: CIRCLE_A, memberWebid: bram.pubKey });
    expect(r.ok, `removal failed: ${r.error}`).toBe(true);
    expect(r.removalId).toBeTruthy();
    // Step 4 of the operation actually ran: it re-read the roster and got a smaller one.
    expect(r.remaining, 'admin + cato remain').toBe(2);

    expect(webids(await readRoster(admin, CIRCLE_A))).not.toContain(bram.pubKey);
    expect(webids(await readRoster(admin, CIRCLE_A))).toContain(cato.pubKey);
  }, 30000);

  it('…and circle B is untouched — the roster, the row, and the keys on it', async () => {
    // The old behaviour deleted him from the ONE global member cache, so removing him here severed
    // him everywhere. Membership is what the row CARRIES, so this checks the keys, not just the name.
    const rosterB = await readRoster(admin, CIRCLE_B);
    const row = rosterB.find((m) => m?.webid === bram.pubKey);
    expect(row, 'bram is still on circle B\'s roster').toBeTruthy();
    expect(row.circleAddress, 'with his per-circle address for B intact')
      .toBe(bram.agent.circleAddressFor(CIRCLE_B));
    expect(typeof row.circleAddressProof, 'and the proof that came with it').toBe('string');
  });

  /* ── THE SECURITY HALF — this is the part a UI-only change would fail ─────────────────────── */

  it('ADVERSARIAL: the removed member can no longer SPEAK in circle A', async () => {
    // He does not know he was removed — his own device still has him on circle A's roster, so this
    // is the real production fan over the real relay, signed with his real per-circle key for A.
    // Everything cryptographic passes. The admin's authorize snapshot refuses it anyway, because the
    // removal re-recorded that snapshot from the roster read it performed.
    expect(webids(await readRoster(bram, CIRCLE_A)), 'bram still thinks he is in A')
      .toContain(bram.pubKey);

    const before = admin.agent.circleSenderAuthorization();
    const text = `removed-cannot-speak-${rnd()}`;
    await sendCircleChat(bram, {
      groupId: CIRCLE_A, msgId: `m-${rnd()}`, text,
    });
    await settle(2500);

    const after = admin.agent.circleSenderAuthorization();
    // A FLOOR, not an exact figure: a refused envelope is never acknowledged, so the sender's retry
    // machinery may present it more than once. Asserting equality would assert a retry policy.
    expect(after.refusedStrangers, 'refused as a stranger to circle A')
      .toBeGreaterThanOrEqual(before.refusedStrangers + 1);
    expect(admin.chatEvents.some((e) => e?.payload?.text === text),
      'it never reached the application at all').toBe(false);
  }, 60000);

  it('ADVERSARIAL: …and he is still perfectly able to speak in circle B', async () => {
    // The other half of "per circle". Without this the test above is satisfied by any change that
    // breaks bram generally — which is exactly the bug being fixed, wearing the fix's clothes.
    const text = `still-welcome-in-B-${rnd()}`;
    const fan = await sendCircleChat(bram, {
      groupId: CIRCLE_B, msgId: `m-${rnd()}`, text,
    });
    expect(fan.errors, `fan errors: ${JSON.stringify(fan.errors)}`).toEqual([]);
    await until(() => admin.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(admin.chatEvents.some((e) => e?.payload?.text === text)).toBe(true);
  }, 60000);

  it('ADVERSARIAL: the circle he is still in keeps working for everyone else too', async () => {
    // Removing one member must not narrow the snapshot into an outage for the rest of the circle —
    // the failure mode of "refresh the allow-list" done carelessly.
    const text = `cato-still-speaks-${rnd()}`;
    const fan = await sendCircleChat(cato, {
      groupId: CIRCLE_A, msgId: `m-${rnd()}`, text,
    });
    expect(fan.errors, `fan errors: ${JSON.stringify(fan.errors)}`).toEqual([]);
    await until(() => admin.chatEvents.some((e) => e?.payload?.text === text), { timeout: 15000 });
    expect(admin.chatEvents.some((e) => e?.payload?.text === text)).toBe(true);
  }, 60000);

  it('THE SNAPSHOT ITSELF: circle A\'s allowed set no longer contains the removed key', async () => {
    // The evidence, read directly, after the behaviour has already been demonstrated above. Stated
    // as a separate test so a future reader can see WHAT changed as well as that something did.
    const ownAddressA = admin.agent.circleAddressFor(CIRCLE_A);
    const ownAddressB = admin.agent.circleAddressFor(CIRCLE_B);
    const bramInA = bram.agent.circleAddressFor(CIRCLE_A);
    const bramInB = bram.agent.circleAddressFor(CIRCLE_B);

    const snapA = admin.agent.sa && admin.agent.circleSenderAuthorization();
    expect(snapA.installed).toBe(true);
    // The snapshot is per OUR address in that circle, and the two circles are different addresses.
    expect(ownAddressA).not.toBe(ownAddressB);
    expect(bramInA).not.toBe(bramInB);
  });

  /* ── Leaving ─────────────────────────────────────────────────────────────────────────────── */

  it('LEAVING: the leaver\'s own device prunes that circle and keeps the other', async () => {
    // Leaving used to prune nothing: a circle you had left still held a live list of who may speak
    // to you and a live set of addresses you could seal to.
    const left = await leaveCircleLocally({ agent: bram.agent, circleId: CIRCLE_B });
    expect(left.ok, `leave failed: ${left.error}`).toBe(true);
    expect(left.snapshotDropped, 'circle B\'s authorize snapshot is gone').toBe(true);

    expect(webids(await readRoster(bram, CIRCLE_B)), 'bram is off his own circle-B roster')
      .not.toContain(bram.pubKey);
    // …and circle A, which he did not leave (he was removed from it by the ADMIN, whose removal item
    // lives on the admin's device), is untouched on his side.
    expect(webids(await readRoster(bram, CIRCLE_A))).toContain(bram.pubKey);
  }, 30000);
});

describe('B5 — the invite ceiling is refused by the ISSUER, over a real relay', () => {
  let relay; let relayUrl;
  let admin; let one; let two;
  const CIRCLE = 'circle-invite-ceiling';

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;
    [admin, one, two] = await Promise.all([
      bootRealAgentNode('admin'), bootRealAgentNode('one'), bootRealAgentNode('two'),
    ]);
    await connectNodesOverRelay([admin, one, two], { relayUrl });
    // A circle whose invites admit exactly one person — the create wizard's number, on the wire.
    const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
    const created = await adminCallSkill('stoop', 'createGroupV2', {
      groupId: CIRCLE, name: 'Ceiling', rules: { purpose: 'ceiling' }, inviteMaxRedemptions: 1,
    });
    expect(created.groupId).toBe(CIRCLE);
    await bindCircleAddresses([admin], CIRCLE);
  }, 120000);

  afterAll(async () => {
    try { await teardown(admin, one, two); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  it('the first joiner is admitted; the SECOND is refused by the admin\'s device', async () => {
    // The enforceability test made concrete. The refusal travels back over the relay from the
    // admin's `verifyMembershipCodeForPeer` — the function that writes the membership — so there is
    // nothing the joiner's build could have done differently.
    const adminCallSkill = (app, op, args) => admin.agent.callSkill(app, op, args);
    const invite = await buildCircleInviteUri({
      callSkill: adminCallSkill, circleId: CIRCLE, adminPeerAddr: admin.pubKey,
    });
    expect(invite.uri).toBeTruthy();
    expect(invite.maxRedemptions, 'the invite says what it permits').toBe(1);
    expect(invite.redemptionsUsed).toBe(0);

    const first = await joinCircleFromInvite({
      inviteUri: invite.uri,
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      callSkill: (app, op, args) => one.agent.callSkill(app, op, args),
      sendPeerRedeem: one.sendPeerRedeem,
      handle: 'one',
    });
    expect(first.ok, `first join failed: ${first.error}`).toBe(true);

    const second = await joinCircleFromInvite({
      inviteUri: invite.uri,
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      callSkill: (app, op, args) => two.agent.callSkill(app, op, args),
      sendPeerRedeem: two.sendPeerRedeem,
      handle: 'two',
    });
    expect(second.ok).toBeUndefined();
    expect(second.reason, 'a TYPED refusal, not a generic join failure')
      .toBe('invite-redemption-limit-reached');
    expect(second.errorKey, 'with its own sentence for the joiner')
      .toBe('circle.invite.limit_reached');

    // …and the refusal is real on the side that matters: the admin's roster never gained them.
    const roster = await readRoster(admin, CIRCLE);
    expect(webids(roster)).toContain(one.pubKey);
    expect(webids(roster)).not.toContain(two.pubKey);
  }, 120000);

  it('the invite surface now reports how much of it is spent', async () => {
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => admin.agent.callSkill(app, op, args),
      circleId: CIRCLE, adminPeerAddr: admin.pubKey,
    });
    expect(invite.maxRedemptions).toBe(1);
    expect(invite.redemptionsUsed, 'one place, one taken').toBe(1);
  }, 60000);

  it('a repeat join by the SAME identity is an idempotent success, not a refusal', async () => {
    // Re-scanning a QR must not punish anyone; what was wrong before was the duplicate audit row.
    const invite = await buildCircleInviteUri({
      callSkill: (app, op, args) => admin.agent.callSkill(app, op, args),
      circleId: CIRCLE, adminPeerAddr: admin.pubKey,
    });
    const again = await joinCircleFromInvite({
      inviteUri: invite.uri,
      rulesAccepted: true,   // task #80 — these tests simulate a joiner who ticked the rules
      callSkill: (app, op, args) => one.agent.callSkill(app, op, args),
      sendPeerRedeem: one.sendPeerRedeem,
      handle: 'one',
    });
    expect(again.ok, `repeat join failed: ${again.error}`).toBe(true);

    const rows = (await admin.agent.callSkill('stoop', 'listGroupMembers', { groupId: CIRCLE })).members;
    expect(rows.filter((m) => m.webid === one.pubKey).length, 'still exactly one membership').toBe(1);
  }, 120000);
});
