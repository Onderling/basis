/**
 * Household sealed-pod membership hooks — redeem → control-agent.addMember (seal the group key to the
 * joiner's sealing public key, carried in the redemption item); leaveGroup → removeMember (revoke +
 * rotate). Gated: no control-agent / no sealing key → no-op. The sealing key is a SEPARATE family from
 * the member's transport identity (NKN/p2p/relay).
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createControlAgent, generateKeypair, unwrapGroupKey } from '@onderling/pod-client';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'] };
const SEAL_PUB = 'bob-sealing-public-key-b64url';

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

function mockControlAgent() {
  return { addMember: vi.fn(async () => ({})), removeMember: vi.fn(async () => ({})) };
}

describe('sealed-pod membership — join', () => {
  it('redeem with a sealing key → control-agent.addMember + the key is recorded on the item', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: r.code, sealingPublicKey: SEAL_PUB }, BOB);

    expect(redeem.redemptionId).toBeTruthy();
    expect(ca.addMember).toHaveBeenCalledWith({ webId: BOB, publicKey: SEAL_PUB, role: 'member', groupId: GROUP });
  });

  it('redeem WITHOUT a sealing key does not call the control-agent (gated)', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode', { rulesAccepted: '1', groupId: GROUP, code: r.code }, BOB);
    expect(redeem.redemptionId).toBeTruthy();        // redemption still works
    expect(ca.addMember).not.toHaveBeenCalled();
  });

  it('no control-agent → redeem still works (non-breaking)', async () => {
    const bundle = await buildBundle();              // no controlAgent
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: r.code, sealingPublicKey: SEAL_PUB }, BOB);
    expect(redeem.redemptionId).toBeTruthy();
  });

  it('a failing control-agent does not break the redemption (best-effort)', async () => {
    const ca = { addMember: vi.fn(async () => { throw new Error('pod down'); }), removeMember: vi.fn() };
    const bundle = await buildBundle({ controlAgent: ca });
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const redeem = await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: r.code, sealingPublicKey: SEAL_PUB }, BOB);
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
      { rulesAccepted: '1', groupId: GROUP, code: r.code, requesterWebid: BOB, sealingPublicKey: SEAL_PUB }, ADMIN);
    expect(ca.addMember).toHaveBeenCalledWith({ webId: BOB, publicKey: SEAL_PUB, role: 'member', groupId: GROUP });
  });
});

describe('sealed-pod membership — leave', () => {
  it('leaveGroup → control-agent.removeMember(webId)', async () => {
    const ca = mockControlAgent();
    const bundle = await buildBundle({ controlAgent: ca });
    await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);
    expect(r.leaveMarkerId).toBeTruthy();
    // `force: true` — a departure is not refusable, so the key custodian's ≥1-admin guard must not be
    // what decides whether the leave rotates. See the note at the `revokeKey` call in
    // `@onderling/circles` leaveGroup; the rotation itself is asserted at the bottom of this file.
    expect(ca.removeMember).toHaveBeenCalledWith({ webId: BOB, force: true, policy: 'graceful', groupId: GROUP });
  });

  it('leaveGroup with no control-agent still works', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);
    expect(r.leaveMarkerId).toBeTruthy();
  });
});

// ── The seam itself: a leave must ROTATE, not merely dispatch ────────────────────────────────────
// The mocked cases above pin the DISPATCH ("removeMember was called with these args"). That is not
// the property anyone relies on — forward secrecy is a property of the KEY, so this drives the real
// `createControlAgent` behind the same production binding (`revokePodAccess`) and asserts the key
// resource itself: a new version, sealed to whoever stays and NOT to whoever left.
//
// The last-admin case is the one that used to fail silently. The control-agent refuses to remove the
// last admin unless the caller forces it, `leaveGroup` did not, and every layer between swallowed the
// throw — so the leave "succeeded" with the group key untouched and the departed admin still holding it.
describe('sealed-pod membership — a leave ROTATES the group key (forward secrecy)', () => {
  function realControlAgent({ roster = [] } = {}) {
    let stored = null;
    const revokes = [];
    const sharing = { grant: async () => {}, revoke: async (o) => { revokes.push(o); } };
    const controllerKey = generateKeypair();
    const keyStore = { read: async () => stored, write: async (r) => { stored = r; } };
    const agent = createControlAgent({
      sharing, containerUri: 'https://pod/circle/', keyStore, controllerKey, roster,
    });
    return { agent, revokes, current: () => stored };
  }
  const canUnwrap = (resource, privateKey) => {
    try { return !!unwrapGroupKey(resource, privateKey); } catch { return false; }
  };

  /** ADMIN holds the circle (the only admin, as a freshly created circle's roster has it); BOB joins. */
  async function circleWithAdminAndBob({ adminSeal, bobSeal }) {
    const ca = realControlAgent({ roster: [{ webId: ADMIN, publicKey: adminSeal.publicKey, role: 'admin' }] });
    await ca.agent.bootstrap();
    const bundle = await buildBundle({ controlAgent: ca.agent });
    const created = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode',
      { rulesAccepted: '1', groupId: GROUP, code: created.code, sealingPublicKey: bobSeal.publicKey }, BOB);
    return { ca, bundle };
  }

  it('an ordinary member leaving rotates the key away from them', async () => {
    const adminSeal = generateKeypair();
    const bobSeal = generateKeypair();
    const { ca, bundle } = await circleWithAdminAndBob({ adminSeal, bobSeal });

    const before = ca.current();
    expect(before.version).toBe(1);
    expect(canUnwrap(before, bobSeal.privateKey)).toBe(true);

    const left = await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, BOB);
    expect(left.leaveMarkerId).toBeTruthy();

    const after = ca.current();
    expect(after.version).toBe(before.version + 1);              // the key actually rotated
    expect(canUnwrap(after, bobSeal.privateKey)).toBe(false);     // the departed opens no new content
    expect(canUnwrap(after, adminSeal.privateKey)).toBe(true);    // whoever stays keeps reading
    expect(ca.revokes.map((r) => r.agent)).toContain(BOB);        // ACL revoked as well
  });

  it('the LAST ADMIN leaving rotates it too — the ≥1-admin guard must not silently skip the rotation', async () => {
    const adminSeal = generateKeypair();
    const bobSeal = generateKeypair();
    const { ca, bundle } = await circleWithAdminAndBob({ adminSeal, bobSeal });

    const before = ca.current();
    expect(before.version).toBe(1);
    expect(canUnwrap(before, adminSeal.privateKey)).toBe(true);

    // The circle's only admin walks out. The circle is not stranded — the roster fold appoints a
    // caretaker from the remaining members — so there is nothing here to protect by refusing.
    const left = await callSkill(bundle.agent, 'leaveGroup', { groupId: GROUP }, ADMIN);
    expect(left.leaveMarkerId).toBeTruthy();

    const after = ca.current();
    expect(after.version).toBe(before.version + 1);               // ← this is what silently did not happen
    expect(canUnwrap(after, adminSeal.privateKey)).toBe(false);    // the departed admin loses new content
    expect(canUnwrap(after, bobSeal.privateKey)).toBe(true);       // the member who stays keeps reading
    expect(ca.revokes.map((r) => r.agent)).toContain(ADMIN);
  });
});
