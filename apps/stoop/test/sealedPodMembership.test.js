/**
 * Household sealed-pod membership hooks — redeem → control-agent.addMember (seal the group key to the
 * joiner's sealing public key, carried in the redemption item); leaveGroup → removeMember (revoke +
 * rotate). Gated: no control-agent / no sealing key → no-op. The sealing key is a SEPARATE family from
 * the member's transport identity (NKN/p2p/relay).
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, VaultMemory, InternalBus, InternalTransport, DataPart } from '@canopy/core';
import { createNeighborhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'buurt', admins: [ADMIN], houseRules: ['wees aardig'] };
const SEAL_PUB = 'bob-sealing-public-key-b64url';

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function buildBundle({ controlAgent } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    skillMatch: { group: GROUP, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
    controlAgent,
  });
  await bundle.skillMatch.start();
  return bundle;
}

function mockControlAgent() {
  return { addMember: vi.fn(async () => ({})), removeMember: vi.fn(async () => ({})) };
}

describe('sealed-pod membership — join', () => {
  it('redeem with a sealing key → control-agent.addMember + the key is recorded on the item', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, sealingPublicKey: SEAL_PUB }, BOB);

    expect(redeem.redemptionId).toBeTruthy();
    expect(ca.addMember).toHaveBeenCalledWith({ webId: BOB, publicKey: SEAL_PUB, role: 'member' });
  });

  it('redeem WITHOUT a sealing key does not call the control-agent (gated)', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();        // redemption still works
    expect(ca.addMember).not.toHaveBeenCalled();
  });

  it('no control-agent → redeem still works (non-breaking)', async () => {
    const bundle = await buildBundle();              // no controlAgent
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, sealingPublicKey: SEAL_PUB }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
  });

  it('a failing control-agent does not break the redemption (best-effort)', async () => {
    const ca = { addMember: vi.fn(async () => { throw new Error('pod down'); }), removeMember: vi.fn() };
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: r.code, sealingPublicKey: SEAL_PUB }, BOB);
    expect(redeem.redemptionId).toBeTruthy();        // audit record still written
    expect(ca.addMember).toHaveBeenCalled();
  });
});

describe('sealed-pod membership — peer (admin-side) join', () => {
  it('verifyMembershipCodeForPeer → addMember for the requester', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
      { groupId: GROUP, code: r.code, requesterWebid: BOB, sealingPublicKey: SEAL_PUB }, ADMIN);
    expect(ca.addMember).toHaveBeenCalledWith({ webId: BOB, publicKey: SEAL_PUB, role: 'member' });
  });
});

describe('sealed-pod membership — leave', () => {
  it('leaveGroup → control-agent.removeMember(webId)', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);
    expect(r.leaveMarkerId).toBeTruthy();
    expect(ca.removeMember).toHaveBeenCalledWith({ webId: BOB, force: false });
  });

  it('leaveGroup with no control-agent still works', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);
    expect(r.leaveMarkerId).toBeTruthy();
  });
});
