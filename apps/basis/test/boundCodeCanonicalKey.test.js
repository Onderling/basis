/**
 * A bound code is checked against the redeemer's CHAT key — the canonical key their verified address resolves to —
 * never against a value in the request (Fable on B3 piece 1). `/koppel` links a person's chat key; they may redeem
 * from another of their addresses (a per-circle one), and that is still them. Someone else naming Bob's key in their
 * request is refused with the same answer as a wrong code.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '@onderling-app/stoop';
import { makeHandleGroupRedeemRequest } from '../src/core/handlers/groupRedeem.js';

const ADMIN = 'https://id.example/admin';
const BOB_KEY = 'bob-chat-key';
const BOB_OTHER_ADDR = 'bob-circle-address';
const MALLORY = 'mallory-address';
const GROUP = 'household:0011223344556677';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: [] };

async function setup() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const b = await createNeighbourhoodAgent({
    identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] }, members: [{ webid: ADMIN, role: 'admin' }],
  });
  await b.offeringMatch.start();
  const callSkill = async (app, op, args, from = ADMIN) => b.agent.skills.get(op).handler({ parts: [DataPart(args)], from, agent: b.agent, envelope: null });
  await callSkill('stoop', 'createGroupV2', { groupId: GROUP, name: 'Thuis', rules: RULES });
  const replies = [];
  const handle = makeHandleGroupRedeemRequest({
    callSkill, sendPeer: async (to, payload) => { replies.push({ to, payload }); },
    // the device-local identity link: Bob's other address is Bob
    identityOf: (addr) => (addr === BOB_OTHER_ADDR ? BOB_KEY : addr),
    logger: { warn() {} },
  });
  const redeem = async (fromAddr, payload) => { await handle(fromAddr, { requestId: `r${replies.length}`, groupId: GROUP, rulesAccepted: '1', ...payload }); return replies.at(-1).payload; };
  return { callSkill, redeem };
}

describe('a bound code and the redeemer\'s canonical key', () => {
  it('Bob\'s code from Bob\'s second address: admitted', async () => {
    const { callSkill, redeem } = await setup();
    const bound = await callSkill('stoop', 'rotateMyGroupCode', { groupId: GROUP, boundTo: BOB_KEY, inviteExpiresInHours: 24 });
    const r = await redeem(BOB_OTHER_ADDR, { code: bound.code });
    expect(r.ok, JSON.stringify(r)).toBe(true);
  });
  it('Mallory\'s request naming Bob\'s key: invalid-or-expired-code', async () => {
    const { callSkill, redeem } = await setup();
    const bound = await callSkill('stoop', 'rotateMyGroupCode', { groupId: GROUP, boundTo: BOB_KEY, inviteExpiresInHours: 24 });
    const r = await redeem(MALLORY, { code: bound.code, requesterKey: BOB_KEY, requesterWebid: BOB_KEY, personKey: { version: 1, pubKey: BOB_KEY } });
    expect(r).toMatchObject({ error: 'invalid-or-expired-code' });
  });
});
