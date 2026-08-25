/**
 * Browser-factory control-agent seam — `createBrowserStoopAgent` is the entry basis uses to boot a
 * real Stoop NeighbourhoodAgent as its circle-membership substrate. The underlying agent already threads a
 * `controlAgent` to the sealed-pod membership hooks (redeem → addMember, leaveGroup → removeMember); this
 * test proves the BROWSER factory now forwards it too (it previously dropped the param silently), so a
 * circle's sealed-pod control-agent can reach those hooks once a producer wires one.
 *
 * Gated + best-effort: no control-agent (or no sealing key) → the membership audit still works, the
 * grant/revoke is simply skipped. Mirrors `sealedPodMembership.test.js`, but via the browser seam.
 */
import { describe, it, expect, vi } from 'vitest';
import { InternalBus, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createBrowserStoopAgent } from '../src/browser.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'cc-test-circle';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'] };
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
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

describe('createBrowserStoopAgent — control-agent seam (basis circle membership)', () => {
  it('forwards the control-agent: redeem → addMember(sealing key)', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBrowserBundle({ controlAgent: ca });
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: created.code, sealingPublicKey: SEAL_PUB }, BOB);

    expect(redeem.redemptionId).toBeTruthy();
    expect(ca.addMember).toHaveBeenCalledWith({ webId: BOB, publicKey: SEAL_PUB, role: 'member', groupId: GROUP });
  });

  it('forwards the control-agent: leaveGroup → removeMember', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBrowserBundle({ controlAgent: ca });
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);

    // `force: true` — a departure is not refusable, so the key custodian's ≥1-admin guard must not be
    // what decides whether the leave rotates. See the note at the `revokeKey` call in
    // `@onderling/circles` leaveGroup; the rotation itself is asserted in sealedPodMembership.test.js.
    expect(ca.removeMember).toHaveBeenCalledWith({ webId: BOB, force: true, policy: 'graceful', groupId: GROUP });
  });

  it('gated: redeem WITHOUT a sealing key does not call the control-agent', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBrowserBundle({ controlAgent: ca });
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: created.code }, BOB);

    expect(redeem.redemptionId).toBeTruthy();      // redemption still works
    expect(ca.addMember).not.toHaveBeenCalled();
  });

  it('non-breaking: no control-agent → redeem still works', async () => {
    const bundle = await buildBrowserBundle();      // no controlAgent
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: created.code, sealingPublicKey: SEAL_PUB }, BOB);

    expect(redeem.redemptionId).toBeTruthy();        // works fine with the seam unused
  });
});
