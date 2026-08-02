/**
 * B5 — one invite is no longer redeemable an unlimited number of times.
 *
 * Walked 2026-07-30 (S6/J-A9): 300 distinct identities redeemed one live code and the roster grew to
 * 307 members in 436 ms — no cap, no throttle, and nothing anywhere saying the code had been used
 * 300 times. Decided the same day (Frits): a **circle-level ceiling**, with each invite choosing
 * within it.
 *
 * The gate is at REDEMPTION, on the ISSUER's device, because that is the device that writes the
 * membership. `verifyMembershipCodeForPeer` IS the admin: a joiner running any build at all only
 * gets in by this function returning a row, so a refusal here is a refusal, not a request. The
 * enforceability test (`docs/conventions/enforceability.md`) is the whole reason the tests below
 * drive the admin-side skill rather than the joiner's wizard.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighborhoodAgent } from '../src/index.js';
import {
  INVITE_REDEMPTION_SYSTEM_CAP, INVITE_CEILING_FALLBACK, INVITE_LIMIT_REACHED,
  circleInviteCeiling, clampInviteMaxRedemptions,
} from '../src/lib/inviteCeiling.js';

const ADMIN = 'https://id.example/admin';
const G = 'buurt-ceiling';

async function callSkill(agent, skillId, args, fromWebid = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

async function buildAdmin() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: G, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/** A joiner presenting the code to the ADMIN's substrate — the real issuer-side path. */
const redeemAs = (bundle, code, who, extra = {}) =>
  callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
    { groupId: G, code, requesterWebid: who, ...extra }, ADMIN);

const rosterSize = async (bundle) =>
  (await callSkill(bundle.agent, 'listGroupMembers', { groupId: G })).members.length;

const trailRows = async (bundle) =>
  (await bundle.itemStore.listOpen({ type: 'membership-redemption' }))
    .filter((i) => i?.source?.groupId === G);

describe('B5 — the three levels: circle ceiling, per-invite choice, system cap', () => {
  it('a circle whose rules say nothing gets the transitional fallback, not "unlimited"', () => {
    expect(circleInviteCeiling(undefined)).toBe(INVITE_CEILING_FALLBACK);
    expect(circleInviteCeiling({})).toBe(INVITE_CEILING_FALLBACK);
  });

  it('an invite may be STRICTER than its circle, never looser', () => {
    expect(clampInviteMaxRedemptions(2, 10)).toBe(2);
    expect(clampInviteMaxRedemptions(50, 10), 'clamped DOWN to the circle ceiling').toBe(10);
    expect(clampInviteMaxRedemptions(undefined, 10), 'absent ⇒ the ceiling itself').toBe(10);
    expect(clampInviteMaxRedemptions(0, 10), 'never below one').toBe(1);
  });

  it('the system cap wins over any circle that asks for more', async () => {
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 100000 });
    expect(created.groupId).toBe(G);
    const rulesItem = (await bundle.itemStore.listOpen({ type: 'group-rules' }))
      .find((i) => i?.source?.groupId === G);
    expect(rulesItem.source.rules.inviteMaxRedemptions).toBe(INVITE_REDEMPTION_SYSTEM_CAP);
    // …and the invite it minted cannot exceed it either.
    const code = await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: G });
    expect(code.maxRedemptions).toBe(INVITE_REDEMPTION_SYSTEM_CAP);
  });

  it('the create wizard\'s number lands on the circle AND on its first invite', async () => {
    const bundle = await buildAdmin();
    await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 3 });
    const code = await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: G });
    expect(code.inviteMaxRedemptions, 'the circle ceiling').toBe(3);
    expect(code.maxRedemptions, 'what this particular invite permits').toBe(3);
    expect(code.redemptionsUsed).toBe(0);
  });

  it('a rotated invite may choose LOWER than the circle ceiling…', async () => {
    const bundle = await buildAdmin();
    await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 8 });
    const rot = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: G, maxRedemptions: 2 });
    expect(rot.maxRedemptions).toBe(2);
    expect(rot.inviteMaxRedemptions).toBe(8);
  });

  it('…and asking for MORE than the ceiling gets the ceiling, not the number asked for', async () => {
    const bundle = await buildAdmin();
    await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 2 });
    const rot = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: G, maxRedemptions: 99 });
    expect(rot.maxRedemptions).toBe(2);
  });
});

describe('B5 — ADVERSARIAL: the ISSUER refuses the redemption past the ceiling', () => {
  it('an invite for two admits two and refuses the third — from the admin\'s side', async () => {
    // Nothing on the joiner's device is consulted. This is `verifyMembershipCodeForPeer`, the skill
    // that writes the membership row; a joiner on a patched build reaches exactly this function and
    // gets exactly this answer.
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 2 });

    expect((await redeemAs(bundle, created.code, 'webid:one')).redemptionId).toBeTruthy();
    expect((await redeemAs(bundle, created.code, 'webid:two')).redemptionId).toBeTruthy();

    const third = await redeemAs(bundle, created.code, 'webid:three');
    expect(third.error).toBe(INVITE_LIMIT_REACHED);
    expect(third.redemptionId, 'no membership was written').toBeUndefined();
    expect(third.used).toBe(2);
    expect(third.max).toBe(2);
  });

  it('the refused identity is not on the roster and has no trail row', async () => {
    // A refusal that still left a row would be a UI refusal. Membership is what the trail says.
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 1 });
    await redeemAs(bundle, created.code, 'webid:one');
    await redeemAs(bundle, created.code, 'webid:two');

    const roster = (await callSkill(bundle.agent, 'listGroupMembers', { groupId: G })).members
      .map((m) => m.webid);
    expect(roster).toContain('webid:one');
    expect(roster).not.toContain('webid:two');
    expect((await trailRows(bundle)).map((i) => i.source.redeemedBy)).not.toContain('webid:two');
  });

  it('300 identities on one code no longer produce 300 memberships (the walked attack)', async () => {
    // The literal J-A9 scale test, run against the gate. Roster = admin + the ceiling, and the rest
    // are refused with the same typed reason rather than being silently admitted.
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 5 });
    const answers = [];
    for (let i = 0; i < 300; i += 1) answers.push(await redeemAs(bundle, created.code, `webid:crowd-${i}`));
    expect(answers.filter((r) => r.redemptionId).length).toBe(5);
    expect(answers.filter((r) => r.error === INVITE_LIMIT_REACHED).length).toBe(295);
    expect(await rosterSize(bundle), 'the founder plus exactly the ceiling').toBe(6);
  }, 60000);

  it('a FRESH invite re-opens the door — the ceiling is per invite, not per circle for all time', async () => {
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 1 });
    await redeemAs(bundle, created.code, 'webid:one');
    expect((await redeemAs(bundle, created.code, 'webid:two')).error).toBe(INVITE_LIMIT_REACHED);

    const rot = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: G });
    expect((await redeemAs(bundle, rot.code, 'webid:two')).redemptionId).toBeTruthy();
  });

  it('the SAME-DEVICE redeem path is gated too, not only the peer one', async () => {
    // `redeemMembershipCode` reads the same code items on the same store. A gate on one path only is
    // the shape of bug `codeRedeemableNow` was extracted to prevent.
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 1 });
    expect((await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: G, code: created.code }, 'webid:local-one')).redemptionId).toBeTruthy();
    const second = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: G, code: created.code }, 'webid:local-two');
    expect(second.error).toBe(INVITE_LIMIT_REACHED);
  });
});

describe('B5 — a repeat redeem by the SAME identity is an idempotent success', () => {
  it('the second redeem succeeds, returns the ORIGINAL id, and writes no second audit row', async () => {
    // Chosen over a refusal (J-A9 left this open). Re-scanning a QR is a thing people do — on a
    // flaky first attempt it is the obvious thing to do — and refusing it teaches nothing while
    // breaking a legitimate retry. What was wrong before was not the success: it was the DUPLICATE
    // ROW, which anything counting rows cannot tell from a second person.
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 3 });

    const first  = await redeemAs(bundle, created.code, 'webid:one');
    const second = await redeemAs(bundle, created.code, 'webid:one');

    expect(second.redemptionId).toBe(first.redemptionId);
    expect(second.alreadyRedeemed).toBe(true);
    expect((await trailRows(bundle)).length, 'exactly one membership row').toBe(1);
  });

  it('…and it does not burn a place: the ceiling counts PEOPLE, not scans', async () => {
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 2 });
    for (let i = 0; i < 5; i += 1) await redeemAs(bundle, created.code, 'webid:one');
    expect((await redeemAs(bundle, created.code, 'webid:two')).redemptionId,
      'the second PERSON still fits').toBeTruthy();
    expect((await redeemAs(bundle, created.code, 'webid:three')).error).toBe(INVITE_LIMIT_REACHED);
  });

  it('the same-device path is idempotent in the same way', async () => {
    const bundle = await buildAdmin();
    const created = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 3 });
    const first  = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: G, code: created.code }, 'webid:local-one');
    const second = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: G, code: created.code }, 'webid:local-one');
    expect(second.redemptionId).toBe(first.redemptionId);
    expect(second.alreadyRedeemed).toBe(true);
    expect((await trailRows(bundle)).length).toBe(1);
  });
});

describe('B5 — a code minted before the ceiling existed', () => {
  it('reads as the circle\'s ceiling, not as unlimited', async () => {
    // The strictest reading that does not invent a number. Treating a missing `maxRedemptions` as
    // "no limit" would keep the bug alive for exactly the codes already in the wild.
    const bundle = await buildAdmin();
    await callSkill(bundle.agent, 'createGroupV2',
      { groupId: G, name: G, rules: {}, inviteMaxRedemptions: 2 });
    // Strip the field the way a pre-2026-08-02 item has it: absent.
    const codeItem = (await bundle.itemStore.listOpen({ type: 'membership-code' }))
      .find((i) => i?.source?.groupId === G);
    const { maxRedemptions, ...legacySource } = codeItem.source;
    expect(maxRedemptions).toBe(2);
    await bundle.itemStore.update(codeItem.id, { source: legacySource }, { actor: ADMIN });

    const code = legacySource.code;
    expect((await redeemAs(bundle, code, 'webid:one')).redemptionId).toBeTruthy();
    expect((await redeemAs(bundle, code, 'webid:two')).redemptionId).toBeTruthy();
    expect((await redeemAs(bundle, code, 'webid:three')).error).toBe(INVITE_LIMIT_REACHED);
  });
});
