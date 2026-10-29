/**
 * A roster-trail row never carries the membership CODE. The trail lives in the circle's own store, and an invite code
 * is an admin's secret: a row names the code it was redeemed with by `codeId` only (the code item's id), which is all the
 * invite ceiling counts by. Each of the three trail writers: a local redeem, the admin's side of a peer redeem, and the
 * joiner's record of a peer-confirmed join.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const CAT   = 'https://id.example/cat';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ADMIN) {
  return agent.skills.get(skillId).handler({ parts: [DataPart(args)], from, agent, envelope: null });
}
async function bundleOf(who) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const b = await createNeighbourhoodAgent({ identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey), offeringMatch: { group: GROUP, localActor: who, peers: [] }, members: [{ webid: who, role: 'admin' }] });
  await b.offeringMatch.start();
  return b;
}
const trailOf = async (b) => (await callSkill(b.agent, 'listOpenRequests', { type: 'membership-redemption' }))?.items ?? [];

describe('the roster trail carries no membership code', () => {
  it('a local redeem and the admin side of a peer redeem record the codeId, never the code', async () => {
    const b = await bundleOf(ADMIN);
    const r = await callSkill(b.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(b.agent, 'redeemMembershipCode', { rulesAccepted: '1', groupId: GROUP, code: r.code }, BOB);
    await callSkill(b.agent, 'verifyMembershipCodeForPeer', { rulesAccepted: '1', groupId: GROUP, code: r.code, requesterWebid: CAT });
    const rows = (await trailOf(b)).filter((it) => it.source?.redeemedBy === BOB || it.source?.redeemedBy === CAT);
    expect(rows).toHaveLength(2);
    for (const it of rows) {
      expect(it.source.code, JSON.stringify(it.source)).toBeUndefined();
      expect(it.source.codeId).toBe(r.codeId);
    }
  });

  it("the joiner's record of a peer-confirmed join keeps the codeId and drops the code", async () => {
    const b = await bundleOf(BOB);
    await callSkill(b.agent, 'recordRemoteRedemption', { groupId: GROUP, code: 'GEHEIM-123', codeId: 'code-1', confirmedBy: ADMIN }, BOB);
    const [row] = (await trailOf(b)).filter((it) => it.source?.groupId === GROUP);
    expect(row?.source?.codeId).toBe('code-1');
    expect(row?.source?.code).toBeUndefined();
  });
});
