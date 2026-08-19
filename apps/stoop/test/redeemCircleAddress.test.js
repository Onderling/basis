/**
 * Per-circle ADDRESS capture at redeem/create (identity substrate step 5B/C —
 * the roster-recording wire).
 *
 * A member presents a per-circle address (`deriveCircleAddress`) — an unlinkable,
 * circle-scoped public key that other members/software cannot correlate to the
 * addresses they present in OTHER circles. On redeem/create it is recorded on the
 * membership-redemption item AND the MemberMap row, and surfaced by
 * listGroupMembers — mirroring `sealingPublicKey`.
 *
 * Wave B (SENSITIVE): a presented circle address is now recorded only when the joiner PROVES
 * control of the key behind it — a signature (by that key) over a challenge bound to the
 * joining circle (Decision B). A co-member who has merely SEEN the address can't forge it, so
 * an unproven address is DROPPED rather than recorded as a false linkage. (The circle CREATE
 * path still records the creator's own address without a proof — they're establishing the
 * circle, not claiming an existing self.)
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { Bootstrap, deriveCircleAddress, signCircleLinkFromSeed } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'] };

// Real per-circle addresses + the join-link proof for BOB (the key behind BOB_ADDR signs the
// challenge bound to GROUP). ADMIN presents their own (create-path, no proof needed).
const _bobSeed   = Bootstrap.fromMnemonic(Bootstrap.create().mnemonic).deriveAgentSeed('bob');
const ADMIN_ADDR = 'circle-addr-admin-oosterpoort';
const BOB_ADDR   = deriveCircleAddress(_bobSeed, GROUP);
const BOB_PROOF  = signCircleLinkFromSeed(_bobSeed, GROUP, GROUP, BOB_ADDR);

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('redeem → capture joiner per-circle address', () => {
  it('records the joiner circle address on the redemption item + MemberMap row', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR, circleAddressProof: BOB_PROOF }, BOB);

    const row = await bundle.members.resolveByWebid(BOB);
    expect(row.circleAddress).toBe(BOB_ADDR);

    const items = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    const mine  = items.find((i) => i?.source?.redeemedBy === BOB);
    expect(mine?.source?.circleAddress).toBe(BOB_ADDR);
  });

  it('createGroupV2 records the admin own circle address on their roster row', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'createGroupV2',
      { groupId: GROUP, name: 'X', rules: RULES, circleAddress: ADMIN_ADDR });
    const row = await bundle.members.resolveByWebid(ADMIN);
    expect(row.circleAddress).toBe(ADMIN_ADDR);
  });

  it('listGroupMembers surfaces per-circle addresses for admin + joiner', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2',
      { groupId: GROUP, name: 'X', rules: RULES, circleAddress: ADMIN_ADDR });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR, circleAddressProof: BOB_PROOF }, BOB);

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    const adminRow = out.members.find((m) => m.webid === ADMIN);
    const bobRow   = out.members.find((m) => m.webid === BOB);
    expect(adminRow?.circleAddress).toBe(ADMIN_ADDR);
    expect(bobRow?.circleAddress).toBe(BOB_ADDR);
  });

  it('listGroupMembers backfills circle address from the redemption trail on reload', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR, circleAddressProof: BOB_PROOF }, BOB);

    // Reload where the roster row lost its circleAddress but the redemption item survives.
    await bundle.members.addMember({ webid: BOB, circleAddress: null });
    expect((await bundle.members.resolveByWebid(BOB)).circleAddress).toBeNull();

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    const bobRow = out.members.find((m) => m.webid === BOB);
    expect(bobRow?.circleAddress).toBe(BOB_ADDR);
  });

  it('SENSITIVE: an address presented WITHOUT a valid proof is DROPPED (no false linkage)', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    // an attacker presents BOB's address but no proof (they've only SEEN it)
    await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code, circleAddress: BOB_ADDR }, BOB);
    expect((await bundle.members.resolveByWebid(BOB)).circleAddress).toBeNull();

    // and a proof for a DIFFERENT joining circle doesn't count either (no cross-circle replay)
    const r2 = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const wrongProof = signCircleLinkFromSeed(_bobSeed, GROUP, 'another-circle', BOB_ADDR);
    await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r2.code, circleAddress: BOB_ADDR, circleAddressProof: wrongProof }, BOB);
    expect((await bundle.members.resolveByWebid(BOB)).circleAddress).toBeNull();
  });

  it('back-compat: a redeem WITHOUT a circle address still works + records none', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
    expect((await bundle.members.resolveByWebid(BOB)).circleAddress).toBeNull();
    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    expect(out.members.find((m) => m.webid === BOB)?.circleAddress ?? null).toBeNull();
  });
});
