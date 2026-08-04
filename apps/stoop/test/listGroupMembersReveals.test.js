// The VIEWER's own "show me names" preference, surfaced under its honest name `viewerNameOptIn`.
// `listGroupMembers` marks a member `viewerNameOptIn: true` iff THIS viewer opted (via their own
// Reveals store — a personal display toggle) to see names. This is NOT a reveal: revealing is the
// DISCLOSER's act (the member's own release), and the ladder gates on THAT. The preference may only
// ever NARROW what a release shows; it can never stand in for the member's consent. These calls are
// LOCAL (the admin's own device), so the reply carries the full view including this marker.
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
  it('default: with nothing opted in, no member row carries the viewer-opt-in marker', async () => {
    const bundle = await buildBundle();
    await seedTwoMembers(bundle);
    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
    for (const m of out.members) expect(m.viewerNameOptIn ?? false).toBe(false);
  });

  it('marks viewerNameOptIn for exactly the members THIS viewer opted to see', async () => {
    const bundle = await buildBundle();
    await seedTwoMembers(bundle);
    // The admin (viewer) opts to see Bob's name but not Cara's (a local viewer choice).
    await callSkill(bundle.agent, 'setPeerReveal', { peerWebid: BOB, showDisplayName: true }, ADMIN);

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
    const bob  = out.members.find((m) => m.webid === BOB);
    const cara = out.members.find((m) => m.webid === CARA);
    expect(bob.viewerNameOptIn).toBe(true);        // opted in to seeing this member's name
    expect(cara.viewerNameOptIn ?? false).toBe(false); // not opted in
  });

  it('group-wide opt-in marks every OTHER member (the group-default branch)', async () => {
    const bundle = await buildBundle();
    await seedTwoMembers(bundle);
    await callSkill(bundle.agent, 'setGroupReveal', { groupId: GROUP, showDisplayName: true }, ADMIN);

    const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
    const others = out.members.filter((m) => m.webid !== ADMIN);
    expect(others.length).toBeGreaterThan(0);
    for (const m of others) expect(m.viewerNameOptIn).toBe(true);   // every other member opted-into
    // The viewer's OWN row is never self-marked.
    expect(out.members.find((m) => m.webid === ADMIN)?.viewerNameOptIn ?? false).toBe(false);
  });
});
