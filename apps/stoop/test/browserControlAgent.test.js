/**
 * Browser-factory control-agent seam — `createBrowserStoopAgent` is the entry canopy-chat uses to boot a
 * real Stoop NeighborhoodAgent as its circle-membership substrate. The underlying agent already threads a
 * `controlAgent` to the sealed-pod membership hooks (redeem → addMember, leaveGroup → removeMember); this
 * test proves the BROWSER factory now forwards it too (it previously dropped the param silently), so a
 * circle's sealed-pod control-agent can reach those hooks once a producer wires one.
 *
 * Gated + best-effort: no control-agent (or no sealing key) → the membership audit still works, the
 * grant/revoke is simply skipped. Mirrors `sealedPodMembership.test.js`, but via the browser seam.
 */
import { describe, it, expect, vi } from 'vitest';
import { InternalBus, VaultMemory, DataPart } from '@canopy/core';
import { createBrowserStoopAgent } from '../src/browser.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'cc-test-buurt';
const RULES = { purpose: 'buurt', admins: [ADMIN], houseRules: ['wees aardig'] };
const SEAL_PUB = 'bob-sealing-public-key-b64url';

function mockControlAgent() {
  return { addMember: vi.fn(async () => ({})), removeMember: vi.fn(async () => ({})) };
}

async function buildBrowserBundle({ controlAgent } = {}) {
  const { bundle } = await createBrowserStoopAgent({
    bus:           new InternalBus(),
    identityVault: new VaultMemory(),
    localActor:    ADMIN,
    group:         GROUP,
    members:       [{ webid: ADMIN, role: 'admin' }],
    controlAgent,
  });
  await bundle.skillMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

describe('createBrowserStoopAgent — control-agent seam (canopy-chat circle membership)', () => {
  it('forwards the control-agent: redeem → addMember(sealing key)', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBrowserBundle({ controlAgent: ca });
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: created.code, sealingPublicKey: SEAL_PUB }, BOB);

    expect(redeem.redemptionId).toBeTruthy();
    expect(ca.addMember).toHaveBeenCalledWith({ webId: BOB, publicKey: SEAL_PUB, role: 'member' });
  });

  it('forwards the control-agent: leaveGroup → removeMember', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBrowserBundle({ controlAgent: ca });
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);

    expect(ca.removeMember).toHaveBeenCalledWith({ webId: BOB, force: false });
  });

  it('gated: redeem WITHOUT a sealing key does not call the control-agent', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBrowserBundle({ controlAgent: ca });
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: created.code }, BOB);

    expect(redeem.redemptionId).toBeTruthy();      // redemption still works
    expect(ca.addMember).not.toHaveBeenCalled();
  });

  it('non-breaking: no control-agent → redeem still works', async () => {
    const bundle = await buildBrowserBundle();      // no controlAgent
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { groupId: GROUP, code: created.code, sealingPublicKey: SEAL_PUB }, BOB);

    expect(redeem.redemptionId).toBeTruthy();        // works fine with the seam unused
  });
});
