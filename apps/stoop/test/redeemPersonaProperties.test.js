// Property layer — a joiner's disclosed PERSONA PROPERTIES (coarse, opt-in) ride the redeem and are
// recorded on the membership-redemption + roster, surfaced by listGroupMembers — mirroring circleAddress.
// Opt-in: absent ⇒ shared nothing (back-compat).
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'circle', admins: [ADMIN], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}
async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({ identity: id, transport: tx, offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] }, members: [{ webid: ADMIN, role: 'admin' }] });
  await bundle.offeringMatch.start();
  return bundle;
}

describe('redeem → capture the joiner disclosed persona properties', () => {
  it('records personaProperties on the roster row + surfaces them in listGroupMembers', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode', { rulesAccepted: '1', groupId: GROUP, code: r.code, personaProperties: { place: 'Groningen', ageBand: '35-54' } }, BOB);

    const row = await bundle.members.resolveByWebid(BOB);
    expect(row.personaProperties).toEqual({ place: 'Groningen', ageBand: '35-54' });

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    expect(out.members.find((m) => m.webid === BOB)?.personaProperties).toEqual({ place: 'Groningen', ageBand: '35-54' });
  });

  it('back-compat: a redeem WITHOUT persona properties records/surfaces none (default-withhold)', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
    await callSkill(bundle.agent, 'redeemMembershipCode', { rulesAccepted: '1', groupId: GROUP, code: r.code }, BOB);
    expect((await bundle.members.resolveByWebid(BOB)).personaProperties).toBeNull();
    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    expect(out.members.find((m) => m.webid === BOB)?.personaProperties ?? null).toBeNull();
  });
});
