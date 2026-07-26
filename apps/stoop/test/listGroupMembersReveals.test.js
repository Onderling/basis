// Wave B — the member-persona per-circle collapse. `listGroupMembers` surfaces a viewer-scoped
// pairwise reveal list (`reveals[]`) so the member-persona card's real-name collapse resolves:
// a member is marked `reveals:[viewerWebid]` iff THIS viewer has opted (via their own Reveals
// store, the same store that gates item-author display names) to see that member's real name.
// Default-withhold; no new network exposure. The collapse itself is proven basis-side in
// apps/basis/test/v2/memberCards.test.js (`m.reveals.includes(viewerWebid)` → realName shown).
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const CARA  = 'https://id.example/cara';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'buurt', admins: [ADMIN], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}
async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({ identity: id, transport: tx, offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] }, members: [{ webid: ADMIN, role: 'admin' }] });
  await bundle.offeringMatch.start();
  return bundle;
}
async function seedTwoMembers(bundle) {
  const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
  await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BOB);
  await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, CARA);
}

describe('listGroupMembers — viewer-scoped pairwise reveal projection (Wave B)', () => {
  it('default-withhold: with no reveals set, every member row surfaces reveals: []', async () => {
    const bundle = await buildBundle();
    await seedTwoMembers(bundle);
    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
    for (const m of out.members) expect(m.reveals ?? []).toEqual([]);
  });

  it('surfaces reveals:[viewerWebid] for exactly the members THIS viewer opted to see', async () => {
    const bundle = await buildBundle();
    await seedTwoMembers(bundle);
    // The admin (viewer) opts to see Bob's name but not Cara's (a local viewer choice).
    await callSkill(bundle.agent, 'setPeerReveal', { peerWebid: BOB, showDisplayName: true }, ADMIN);

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
    const bob  = out.members.find((m) => m.webid === BOB);
    const cara = out.members.find((m) => m.webid === CARA);
    expect(bob.reveals).toEqual([ADMIN]);   // opted in → the card will show the real name
    expect(cara.reveals ?? []).toEqual([]); // not opted in → stays withheld
  });

  it('group-wide reveal opts the viewer into every OTHER member (the group-default branch)', async () => {
    const bundle = await buildBundle();
    await seedTwoMembers(bundle);
    await callSkill(bundle.agent, 'setGroupReveal', { groupId: GROUP, showDisplayName: true }, ADMIN);

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
    const others = out.members.filter((m) => m.webid !== ADMIN);
    expect(others.length).toBeGreaterThan(0);
    for (const m of others) expect(m.reveals).toEqual([ADMIN]);   // every other member now visible
    // The viewer's OWN row is never self-marked.
    expect(out.members.find((m) => m.webid === ADMIN)?.reveals ?? []).toEqual([]);
  });
});
