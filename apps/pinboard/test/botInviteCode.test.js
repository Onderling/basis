/**
 * An invite FOR A BOT: the admin's single-use code marked `forFunction` (the admin's signed join then says the bot is
 * one). Like a bound code it is never "the circle's current code" a member passes on, minting it closes no other
 * code, and a rotation of the shared code leaves it open.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOT = 'https://id.example/bot';
const GROUP = 'household:8899aabbccddeeff';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'], keyRotationMode: 'peer-distributable' };

async function callSkill(agent, skillId, args, from = ADMIN) {
  return agent.skills.get(skillId).handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
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

describe('a bot invite code', () => {
  it('single use, never the current code; it closes no code and no rotation closes it', async () => {
    const b = await bundle();
    const shared = (await callSkill(b.agent, 'createGroupV2', { groupId: GROUP, name: 'Thuis', rules: RULES })).code;
    const bot = await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP, forFunction: true, maxRedemptions: 5 });
    expect(bot.code, JSON.stringify(bot)).toBeTruthy();
    expect(bot.maxRedemptions).toBe(1);
    expect((await callSkill(b.agent, 'getCurrentMembershipCode', { groupId: GROUP })).code).toBe(shared);
    await callSkill(b.agent, 'rotateMyGroupCode', { groupId: GROUP });
    const ok = await callSkill(b.agent, 'verifyMembershipCodeForPeer', { groupId: GROUP, code: bot.code, requesterWebid: BOT, rulesAccepted: '1', profileKind: 'function' });
    expect(ok.redemptionId, JSON.stringify(ok)).toBeTruthy();
  });
});
