/**
 * RE-TEST (2026-09-04, at Frits' request) — "a restored member cannot rejoin their own circle; they fail
 * handle-taken".
 *
 * That claim has been carried on the go-live checklist for weeks and was scoped for a fix. It reasons that
 * "the join path checks the handle before anything recognises the identity is the same person". But the
 * identity it would recognise is STABLE across devices: the chat identity is derived from the profile, not
 * the device, so a restored or enrolled device presents the same webid — and `findHandleCollision` skips
 * rows whose webid equals the claimant's.
 *
 * These drive the ADMIN's own skill, which is where the refusal would come from (a joiner running any
 * build only gets in by this returning a row), and pin the rule either way.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const ANNA  = 'https://id.example/anna';     // her webid — the same on every device she owns
const OTHER = 'https://id.example/someone-else';
const G = 'circle-restore-rejoin';

async function callSkill(agent, skillId, args, fromWebid = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from: fromWebid, agent, envelope: null });
}

async function buildAdmin() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: G, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

const redeemAs = (bundle, code, who, handle) =>
  callSkill(bundle.agent, 'verifyMembershipCodeForPeer',
    { rulesAccepted: '1', groupId: G, code, requesterWebid: who, peerDisplay: handle }, ADMIN);

describe('a restored member coming back to a circle they are already in', () => {
  it('is NOT refused as a stranger holding their own handle', async () => {
    const admin = await buildAdmin();
    await callSkill(admin.agent, 'createGroupV2', { groupId: G, name: G, rules: {} });
    const { code } = await callSkill(admin.agent, 'getCurrentMembershipCode', { groupId: G });
    expect(typeof code).toBe('string');

    // Her first device joins as @anna.
    const first = await redeemAs(admin, code, ANNA, 'anna');
    expect(first.error, 'the original join').toBeUndefined();

    // Her replacement device — the phrase re-derives the SAME webid — comes back with the same handle.
    const again = await redeemAs(admin, code, ANNA, 'anna');
    expect(again.error, 'a restored member must not be refused their own handle').toBeUndefined();
    expect(again.redemptionId ?? again.alreadyRedeemed, 'she is admitted, one way or the other').toBeTruthy();

    // …and she is ONE member, not two.
    const roster = await callSkill(admin.agent, 'listGroupMembers', { groupId: G });
    const annas = roster.members.filter((m) => (m.webid ?? m.id) === ANNA);
    expect(annas.length, 'one person, one row').toBe(1);
  });

  it('while a DIFFERENT person claiming that handle is still refused', async () => {
    const admin = await buildAdmin();
    await callSkill(admin.agent, 'createGroupV2', { groupId: G, name: G, rules: {} });
    const { code } = await callSkill(admin.agent, 'getCurrentMembershipCode', { groupId: G });
    await redeemAs(admin, code, ANNA, 'anna');
    const impostor = await redeemAs(admin, code, OTHER, 'anna');
    expect(impostor.error, 'handle uniqueness still binds for a stranger').toBe('handle-taken');
  });
});
