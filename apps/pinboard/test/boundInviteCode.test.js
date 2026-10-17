/**
 * A code bound to ONE person's key, for one use: the household bot hands a person who said yes a code that only THEY
 * can redeem (their authenticated key is the redeem's sender), once, for a day. Minting it closes nobody else's code,
 * and it is never "the circle's current code" that a member may pass on. A code without `boundTo` behaves as before.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB = 'https://id.example/bob';
const EVE = 'https://id.example/eve';
const CAROL = 'https://id.example/carol';
const GROUP = 'household:0011223344556677';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'], keyRotationMode: 'peer-distributable' };

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}
async function bundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const b = await createNeighbourhoodAgent({
    identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] }, members: [{ webid: ADMIN, role: 'admin' }],
  });
  await b.offeringMatch.start();
  return b;
}
const peerRedeem = (b, code, who) => callSkill(b.agent, 'verifyMembershipCodeForPeer', { groupId: GROUP, code, requesterWebid: who, rulesAccepted: '1' });

describe('a code bound to one key, single use', () => {
  it('only its person redeems it, once; nobody else\'s code is closed; it is never the current code', async () => {
    const b = await bundle();
    const created = await callSkill(b.agent, 'createGroupV2', { groupId: GROUP, name: 'Thuis', rules: RULES });
    const shared = created.code;
    const bound = await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP, boundTo: BOB, inviteExpiresInHours: 24 });
    expect(bound.code, JSON.stringify(bound)).toBeTruthy();
    expect(bound.maxRedemptions).toBe(1);
    expect(bound.expiresAt - Date.now()).toBeGreaterThan(23 * 3_600_000);

    // never the code a member may pass on
    expect((await callSkill(b.agent, 'getCurrentMembershipCode', { groupId: GROUP })).code).toBe(shared);
    // someone else holding Bob's code: refused, the same answer as a wrong code
    expect(await peerRedeem(b, bound.code, EVE)).toMatchObject({ error: 'invalid-or-expired-code' });
    expect(await callSkill(b.agent, 'redeemMembershipCode', { groupId: GROUP, code: bound.code, rulesAccepted: '1' }, EVE)).toMatchObject({ error: 'invalid-or-expired-code' });
    // Bob: in
    const ok = await peerRedeem(b, bound.code, BOB);
    expect(ok.redemptionId, JSON.stringify(ok)).toBeTruthy();
    // the shared code still works for Carol: the bound mint closed nothing
    expect((await peerRedeem(b, shared, CAROL)).redemptionId).toBeTruthy();
    // a second bound code for Eve leaves Bob's alone, and a rotation of the shared code leaves Eve's alone
    const forEve = await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP, boundTo: EVE, inviteExpiresInHours: 24 });
    await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP });
    expect((await peerRedeem(b, forEve.code, EVE)).redemptionId).toBeTruthy();
  });

  it('single use: a second person can never ride it, and the same person again is the same redemption', async () => {
    const b = await bundle();
    await callSkill(b.agent, 'createGroupV2', { groupId: GROUP, name: 'Thuis', rules: RULES });
    const bound = await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP, boundTo: BOB, maxRedemptions: 5, inviteExpiresInHours: 24 });
    expect(bound.maxRedemptions).toBe(1);   // whatever is asked
    const first = await peerRedeem(b, bound.code, BOB);
    const again = await peerRedeem(b, bound.code, BOB);
    expect(again.redemptionId).toBe(first.redemptionId);
  });

  it('only an admin binds a code', async () => {
    const b = await bundle();
    await callSkill(b.agent, 'createGroupV2', { groupId: GROUP, name: 'Thuis', rules: RULES });
    expect(await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP, boundTo: EVE }, EVE)).toMatchObject({ error: 'admin-only' });
  });
});
