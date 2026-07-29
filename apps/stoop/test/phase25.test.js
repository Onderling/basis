/**
 * Stoop V2 — Phase 25 tests.
 *
 * Self-create groups + rotating membership codes (two modes).
 *
 *   25.3  createGroupV2 mints rules + initial code; caller becomes admin
 *   25.4  rotateMyGroupCode (admin-only); getCurrentMembershipCode
 *         (admin always; member only when peer-distributable);
 *         redeemMembershipCode (current OR within 24h grace)
 *   25.7  getMyMembershipStatus reports active vs evicted
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighborhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';

async function callSkill(agent, skillId, args, fromWebid = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildBundle({ actor = ADMIN, role = 'admin' } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: actor, peers: [] },
    members:    [{ webid: actor, role }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

const GROUP = 'oosterpoort';
const RULES = {
  purpose: 'buurt-skills',
  admins:  [ADMIN],
  houseRules: ['wees aardig'],
};

/* ── 25.3 createGroupV2 ────────────────────────────────────── */

describe('Stoop V2 Phase 25.3 — createGroupV2', () => {
  it('mints rules + initial code; returns the code to the caller', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'Oosterpoort',
      rules:   RULES,
      keyRotationMode: 'admin-only',
      rotationDays: 30,
    });
    expect(r.groupId).toBe(GROUP);
    expect(typeof r.code).toBe('string');
    expect(r.code.length).toBeGreaterThan(8);
    expect(r.expiresAt).toBeGreaterThan(Date.now());
    expect(r.keyRotationMode).toBe('admin-only');
    expect(r.rotationDays).toBe(30);
  });

  it('rejects invalid rotationDays gracefully (clamps to 30 default)', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
      rotationDays: -1,
    });
    expect(r.rotationDays).toBe(30);
  });

  it('caller becomes admin in MemberMap', async () => {
    const bundle = await buildBundle({ actor: ANNE, role: null });
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    }, ANNE);
    const me = await bundle.members.resolveByWebid(ANNE);
    expect(me.role).toBe('admin');
  });

  it('keyRotationMode persists into the rules blob', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
      keyRotationMode: 'peer-distributable',
    });
    const r = await callSkill(bundle.agent, 'getGroupRules', { groupId: GROUP });
    expect(r.rules.source.rules.keyRotationMode).toBe('peer-distributable');
    expect(r.rules.source.rules.rotationDays).toBe(30);
  });
});

/* ── 25.4 rotateMyGroupCode + getCurrentMembershipCode ─────── */

describe('Stoop V2 Phase 25.4 — rotation + read', () => {
  it('rotateMyGroupCode (admin) yields a new code', async () => {
    const bundle = await buildBundle();
    const c1 = (await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    })).code;
    const r2 = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP });
    expect(r2.code).toBeTruthy();
    expect(r2.code).not.toBe(c1);
  });

  it('rotateMyGroupCode rejects non-admin', async () => {
    const bundle = await buildBundle({ actor: ANNE, role: 'member' });
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    }, ANNE);   // ANNE became admin via createGroupV2
    // Demote ANNE to member to test admin-gate.
    await bundle.members.addMember({ webid: ANNE, role: 'member' });
    const r = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP }, ANNE);
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('getCurrentMembershipCode admin-only mode: member denied', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
      keyRotationMode: 'admin-only',
    });
    // ANNE is unknown → not admin.  Expect 'admin-only'.
    const r = await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: GROUP }, ANNE);
    expect(r).toEqual({ error: 'admin-only' });
  });

  it('getCurrentMembershipCode peer-distributable: member allowed', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
      keyRotationMode: 'peer-distributable',
    });
    const r = await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: GROUP }, ANNE);
    expect(r.code).toBeTruthy();
    expect(r.keyRotationMode).toBe('peer-distributable');
  });

  it('getCurrentMembershipCode returns latest after rotation', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    });
    const before = (await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: GROUP })).code;
    await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP });
    const after  = (await callSkill(bundle.agent, 'getCurrentMembershipCode', { groupId: GROUP })).code;
    expect(after).not.toBe(before);
  });
});

/* ── redeemMembershipCode ──────────────────────────────────── */

describe('Stoop V2 Phase 25.4 — redeemMembershipCode', () => {
  it('current code redeems and records a membership-redemption item', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
    expect(redeem.validUntil).toBe(r.expiresAt);
  });

  it('invalid code rejected', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    });
    const r = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: 'wrong-code-xx' }, BOB);
    expect(r).toEqual({ error: 'invalid-or-expired-code' });
  });

  it('ROTATION REMOVES: the previous code stops working immediately', async () => {
    // This test used to assert the opposite — "previous code remains valid during 24h grace window" —
    // and that was the vulnerability, not the feature (walked 2026-07-29, S6/J-A8). Rotation claimed in
    // its own docstring to mark the old code stale and did not: it only added a newer row, while the
    // redeem gate accepted any row inside its expiry plus a day. So rotating did not remove anybody, and
    // an admin who rotated after a code leaked had done nothing for 24 hours.
    //
    // Rotation is an act of removal. An already-redeemed MEMBERSHIP keeps its own generous grace
    // (`MEMBERSHIP_GRACE_MS`), so nobody already inside is evicted by this — the two questions no longer
    // share a constant.
    const bundle = await buildBundle();
    const r1 = await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    });
    await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r1.code }, BOB);
    expect(redeem).toEqual({ error: 'invalid-or-expired-code' });
  });

  it('…and the FRESH code from that rotation does work', async () => {
    // The other half, so "rotation removes" cannot be satisfied by breaking rotation altogether.
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const rotated = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: rotated.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
  });
});

/* ── 25.7 getMyMembershipStatus ────────────────────────────── */

describe('Stoop V2 Phase 25.7 — getMyMembershipStatus', () => {
  it('returns redeemed: false before any redemption', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    });
    const r = await callSkill(bundle.agent, 'getMyMembershipStatus', { groupId: GROUP }, BOB);
    expect(r).toEqual({ redeemed: false });
  });

  it('returns isActive: true after a fresh redemption', async () => {
    const bundle = await buildBundle();
    const c = (await callSkill(bundle.agent, 'createGroupV2', {
      groupId: GROUP, name: 'X', rules: RULES,
    })).code;
    await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: c }, BOB);
    const r = await callSkill(bundle.agent, 'getMyMembershipStatus', { groupId: GROUP }, BOB);
    expect(r.redeemed).toBe(true);
    expect(r.isActive).toBe(true);
  });
});

/* ── S6/J-A6 — an invite's expiry is enforced where it is redeemed ──────────── */

describe("a code's expiry is enforced at the redeem, not merely displayed", () => {
  // Walked 2026-07-29. The redeem gate accepted any code row inside `expiresAt + 24h`, so the enforced
  // life of an invite was its own TTL plus a day: one clamped to 15 minutes and read aloud in a café was
  // still redeemable 16 minutes later, and at two hours with its own expiry already past. The 24h came
  // from a constant shared with a different question — whether an already-redeemed MEMBERSHIP is still
  // active — where being generous is kind rather than dangerous.
  it('a code past its expiry is refused', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    // Mint one that expires almost immediately (1 h is the floor the op accepts), then age it by hand.
    const rotated = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP, inviteExpiresInHours: 1 });
    const codes = (await bundle.itemStore.listOpen({ type: 'membership-code' }))
      .filter((i) => i.source?.groupId === GROUP && i.source?.code === rotated.code);
    expect(codes).toHaveLength(1);
    await bundle.itemStore.update(codes[0].id,
      { source: { ...codes[0].source, expiresAt: Date.now() - 10 * 60 * 1000 } }, { actor: ADMIN });

    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: rotated.code }, BOB);
    expect(redeem).toEqual({ error: 'invalid-or-expired-code' });
  });

  it('a small clock difference is still tolerated — the allowance is skew, not a second lifetime', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const rotated = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP, inviteExpiresInHours: 1 });
    const codes = (await bundle.itemStore.listOpen({ type: 'membership-code' }))
      .filter((i) => i.source?.groupId === GROUP && i.source?.code === rotated.code);
    // Expired 30 seconds ago: within the skew allowance, so an honest joiner whose clock is a little off
    // is not turned away at the door.
    await bundle.itemStore.update(codes[0].id,
      { source: { ...codes[0].source, expiresAt: Date.now() - 30 * 1000 } }, { actor: ADMIN });

    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: rotated.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
  });

  it('a code with no expiry at all is refused rather than treated as eternal', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const rotated = await callSkill(bundle.agent, 'rotateMyGroupCode', { groupId: GROUP });
    const codes = (await bundle.itemStore.listOpen({ type: 'membership-code' }))
      .filter((i) => i.source?.groupId === GROUP && i.source?.code === rotated.code);
    const { expiresAt, ...noExpiry } = codes[0].source;
    await bundle.itemStore.update(codes[0].id, { source: noExpiry }, { actor: ADMIN });

    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: rotated.code }, BOB);
    expect(redeem).toEqual({ error: 'invalid-or-expired-code' });
  });
});
