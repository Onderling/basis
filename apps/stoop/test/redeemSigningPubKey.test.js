/**
 * Signing-pubKey capture at redeem (circle fan-out fix).
 *
 * When a joiner redeems a membership code we record their SIGNING pubKey —
 * the transport/chat-agent identity that circle fan-out routes to — on the
 * redemption item AND in the MemberMap, so `wireChat.send` can resolve a
 * code-redeemer instead of returning `recipient-pubkey-unknown`.
 *
 * SECURITY: the pubKey binds to the AUTHENTICATED sender of the redeem
 * (`from` = the skill-invocation actor / `envelope._from`), NOT a self-asserted
 * body field.  In this architecture a member's webid IS their secure-mesh
 * signing address, so the authenticated identity for the joiner is `from`.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';   // stands in for BOB's secure-mesh signing address
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle({ controlAgent } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
    controlAgent,
  });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('redeem → capture joiner signing pubKey', () => {
  it('records the AUTHENTICATED sender pubKey on the item + MemberMap', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();

    // Bonus the task asks us to assert: resolveByWebid(joiner).pubKey === joiner's signing key.
    const row = await bundle.members.resolveByWebid(BOB);
    expect(row).toBeTruthy();
    expect(row.pubKey).toBe(BOB);

    // Mirrored on the redemption audit item (sibling of sealingPublicKey).
    const items = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    const mine  = items.find((i) => i?.source?.redeemedBy === BOB);
    expect(mine?.source?.signingPublicKey).toBe(BOB);
  });

  it('a spoofed body pubKey does NOT override the authenticated sender', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    // Attacker (redeeming as BOB) tries to claim MALLORY's routing key via the body.
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, pubKey: 'mallory-key', myPubKey: 'mallory-key', signingPublicKey: 'mallory-key' }, BOB);

    const row = await bundle.members.resolveByWebid(BOB);
    expect(row.pubKey).toBe(BOB);            // authenticated `from`, not the body claim
    expect(row.pubKey).not.toBe('mallory-key');
    // And no entry was minted for the spoofed key.
    expect(await bundle.members.resolveByWebid('mallory-key')).toBeNull();
  });

  it('circle fan-out resolves a code-redeemer (no recipient-pubkey-unknown)', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });

    // Control: before redeem, a stranger cannot be resolved.
    const before = await bundle.chat.send({ toWebid: BOB, subtype: 'reveal-request', threadId: GROUP });
    expect(before.ok).toBe(false);
    expect(before.reason).toBe('recipient-pubkey-unknown');

    await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);

    // After redeem, the pubKey resolves — send no longer bails on the pubkey gate.
    const after = await bundle.chat.send({ toWebid: BOB, subtype: 'reveal-request', threadId: GROUP });
    expect(after.reason).not.toBe('recipient-pubkey-unknown');
  });

  it('back-compat: redeem still works + is additive (no MemberMap wipe, gated control-agent)', async () => {
    const ca = { addMember: vi.fn(async () => ({})), removeMember: vi.fn(async () => ({})) };
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    // No sealing key, no body pubKey — an older client shape.
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();          // redemption unaffected
    expect(ca.addMember).not.toHaveBeenCalled();        // sealing path still gated on sealingPublicKey
    expect((await bundle.members.resolveByWebid(BOB)).pubKey).toBe(BOB); // signing pubKey still captured
  });

  it('listGroupMembers backfills pubKey from the redemption trail on reload', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);

    // Simulate a reload where the roster row lost its pubKey but the redemption
    // item (with signingPublicKey) survives — the reduction should backfill it.
    await bundle.members.addMember({ webid: BOB, pubKey: null });
    expect((await bundle.members.resolveByWebid(BOB)).pubKey).toBeNull();

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    const bobRow = out.members.find((m) => m.webid === BOB);
    expect(bobRow?.pubKey).toBe(BOB);
  });
});

describe('verifyMembershipCodeForPeer → capture requester signing pubKey (admin roster)', () => {
  it('populates the admin MemberMap so cross-instance fan-out resolves', async () => {
    const ca = { addMember: vi.fn(async () => ({})), removeMember: vi.fn(async () => ({})) };
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    // `from` is the ADMIN; requesterWebid is set by the admin handler from the
    // authenticated NKN fromAddr (here BOB).
    await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code: r.code, requesterWebid: BOB }, ADMIN);

    expect((await bundle.members.resolveByWebid(BOB)).pubKey).toBe(BOB);
    const items = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    expect(items.find((i) => i?.source?.redeemedBy === BOB)?.source?.signingPublicKey).toBe(BOB);
  });
});
