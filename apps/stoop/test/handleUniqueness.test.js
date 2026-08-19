/**
 * Phase 4 Wave B — per-circle handle-uniqueness enforcement.
 *
 * Pinned rule (2026-07-24, NOTE-identity-and-linkability.md): NO duplicate
 * handles within a single circle — mandatory (there is no disambiguation).
 * Cross-circle reuse stays allowed (a handle is circle-local). Enforcement
 * lives on the admin/host side, which holds the roster.
 *
 * Two claim points are guarded:
 *   - `setMyHandle` (set / change-handle) — checks the in-circle MemberMap.
 *   - `verifyMembershipCodeForPeer` (admin-side join-redeem) — checks the
 *     durable `membership-redemption` trail (`peerDisplay`) for THIS circle.
 *
 * Collisions are case-folded (matching `validateHandle`'s normalisation), so
 * `Jan` and `jan` are the same handle. A member re-claiming their OWN current
 * handle is not a collision. Format validation still applies first.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE  = 'https://id.example/anne';
const BOB   = 'https://id.example/bob';
const CAROL = 'https://id.example/carol';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ANNE], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle({ group = GROUP, localActor = ANNE, members } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group, localActor, peers: [] },
    // Pre-seed both webids so setMyHandle upserts an existing row.
    members: members ?? [{ webid: ANNE }, { webid: BOB }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

// ── setMyHandle (set / change-handle) ─────────────────────────────────────

describe('setMyHandle — per-circle handle uniqueness', () => {
  it('rejects a handle already held by another member of the circle', async () => {
    const bundle = await buildBundle();
    const first = await callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, ANNE);
    expect(first.handle).toBe('jan');

    const clash = await callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, BOB);
    expect(clash.error).toBe('invalid-handle');
    expect(clash.reason).toBe('handle-taken');

    // The rejected claim must NOT have mutated BOB's row.
    const bob = await bundle.members.resolveByWebid(BOB);
    expect(bob.handle).toBe(null);
  });

  it('is case-insensitive — `Jan` collides with an existing `jan`', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, ANNE);
    const clash = await callSkill(bundle.agent, 'setMyHandle', { handle: 'Jan' }, BOB);
    expect(clash.error).toBe('invalid-handle');
    expect(clash.reason).toBe('handle-taken');
  });

  it('lets a member RE-SET their own current handle (not a collision)', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, ANNE);
    const again = await callSkill(bundle.agent, 'setMyHandle', { handle: 'jan' }, ANNE);
    expect(again.error).toBeUndefined();
    expect(again.handle).toBe('jan');
    // ...and re-setting via a different case is still fine for the owner.
    const cased = await callSkill(bundle.agent, 'setMyHandle', { handle: 'JAN' }, ANNE);
    expect(cased.error).toBeUndefined();
    expect(cased.handle).toBe('jan');
  });

  it('still applies format validation before the uniqueness check', async () => {
    const bundle = await buildBundle();
    const tooShort = await callSkill(bundle.agent, 'setMyHandle', { handle: 'an' }, BOB);
    expect(tooShort.error).toBe('invalid-handle');
    expect(tooShort.reason).toBe('too-short');
  });

  it('allows the SAME handle in a DIFFERENT circle (cross-circle reuse)', async () => {
    const circleA = await buildBundle({ group: 'circle-a' });
    const circleB = await buildBundle({ group: 'circle-b' });
    const a = await callSkill(circleA.agent, 'setMyHandle', { handle: 'jan' }, ANNE);
    const b = await callSkill(circleB.agent, 'setMyHandle', { handle: 'jan' }, BOB);
    expect(a.handle).toBe('jan');
    expect(b.handle).toBe('jan');
  });
});

// ── verifyMembershipCodeForPeer (admin-side join-redeem) ───────────────────

describe('join-redeem — per-circle handle uniqueness (admin/host side)', () => {
  async function adminWithCode() {
    // ANNE is the admin/host who owns the roster.
    const bundle = await buildBundle({ members: [{ webid: ANNE, role: 'admin' }] });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES }, ANNE);
    return { bundle, code: r.code };
  }

  it('rejects a second joiner claiming a handle already taken in the circle', async () => {
    const { bundle, code } = await adminWithCode();
    const first = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE);
    expect(first.error).toBeUndefined();
    expect(first.redemptionId).toBeTruthy();

    const clash = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code, requesterWebid: CAROL, peerDisplay: 'jan' }, ANNE);
    expect(clash.error).toBe('handle-taken');

    // The rejected join must NOT have written a redemption for CAROL.
    const reds = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    expect(reds.some((i) => i?.source?.redeemedBy === CAROL)).toBe(false);
  });

  it('is case-insensitive — `Jan` collides with a joiner already on `jan`', async () => {
    const { bundle, code } = await adminWithCode();
    await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE);
    const clash = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code, requesterWebid: CAROL, peerDisplay: 'Jan' }, ANNE);
    expect(clash.error).toBe('handle-taken');
  });

  it('lets the SAME joiner re-present their own handle (not a collision)', async () => {
    const { bundle, code } = await adminWithCode();
    await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE);
    const again = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE);
    expect(again.error).toBeUndefined();
    expect(again.redemptionId).toBeTruthy();
  });

  it('allows the SAME handle in a DIFFERENT circle (cross-circle reuse)', async () => {
    // One admin store hosting two circles; the same peerDisplay in each is fine.
    const bundle = await buildBundle({ members: [{ webid: ANNE, role: 'admin' }] });
    const a = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: 'circle-a', name: 'A', rules: { purpose: 'circle', admins: [ANNE] } }, ANNE);
    const b = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: 'circle-b', name: 'B', rules: { purpose: 'circle', admins: [ANNE] } }, ANNE);

    const inA = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: 'circle-a', code: a.code, requesterWebid: BOB, peerDisplay: 'jan' }, ANNE);
    const inB = await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: 'circle-b', code: b.code, requesterWebid: CAROL, peerDisplay: 'jan' }, ANNE);
    expect(inA.error).toBeUndefined();
    expect(inB.error).toBeUndefined();
    expect(inB.redemptionId).toBeTruthy();
  });
});
