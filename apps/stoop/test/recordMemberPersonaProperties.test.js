// Property layer — "share to this circle" (POST-join disclosure push). The admin-side write:
// recordMemberPersonaProperties lands an already-joined member's freshly-disclosed persona
// properties onto the roster row AND patches the durable redemption-item source (so it survives a
// roster rebuild, like the join-time capture). Only existing members; {} clears; not-a-member guarded.
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/admin';
const BOB   = 'https://id.example/bob';
const NOBODY = 'https://id.example/nobody';
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
async function joinBob(bundle, personaProperties) {
  const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
  await callSkill(bundle.agent, 'redeemMembershipCode', { rulesAccepted: '1', groupId: GROUP, code: r.code, ...(personaProperties ? { personaProperties } : {}) }, BOB);
}

describe('recordMemberPersonaProperties — post-join "share to this circle"', () => {
  it('lands a post-join disclosure on the roster row + surfaces it via listGroupMembers', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle);                                        // BOB joins sharing nothing
    expect((await bundle.members.resolveByWebid(BOB)).personaProperties).toBeNull();

    const out = await callSkill(bundle.agent, 'recordMemberPersonaProperties', {
      groupId: GROUP, memberWebid: BOB, personaProperties: { place: 'Groningen', ageBand: '35-54' },
    });
    expect(out.ok).toBe(true);
    expect(out.keys.sort()).toEqual(['ageBand', 'place']);
    // A first disclosure is a REAL change — both keys are reported for the pull-me signal.
    expect(out.changedKeys.sort()).toEqual(['ageBand', 'place']);
    expect(out.unchanged).toBeUndefined();

    expect((await bundle.members.resolveByWebid(BOB)).personaProperties).toEqual({ place: 'Groningen', ageBand: '35-54' });
    const list = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    expect(list.members.find((m) => m.webid === BOB)?.personaProperties).toEqual({ place: 'Groningen', ageBand: '35-54' });
  });

  it('DIFF-GATE: re-recording the SAME disclosure is a true no-op (unchanged, no changed keys)', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle, { place: 'Groningen', ageBand: '35-54' });   // already sharing exactly this

    const out = await callSkill(bundle.agent, 'recordMemberPersonaProperties', {
      groupId: GROUP, memberWebid: BOB, personaProperties: { ageBand: '35-54', place: 'Groningen' },
    });
    expect(out.ok).toBe(true);
    expect(out.unchanged).toBe(true);
    expect(out.changedKeys).toEqual([]);
    // The row still reads exactly the same — nothing was rewritten.
    expect((await bundle.members.resolveByWebid(BOB)).personaProperties).toEqual({ place: 'Groningen', ageBand: '35-54' });
  });

  it('DIFF-GATE: a partial edit reports ONLY the keys that really moved', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle, { place: 'Groningen', ageBand: '35-54' });

    const out = await callSkill(bundle.agent, 'recordMemberPersonaProperties', {
      groupId: GROUP, memberWebid: BOB, personaProperties: { place: 'Utrecht', ageBand: '35-54' },
    });
    expect(out.ok).toBe(true);
    expect(out.unchanged).toBeUndefined();
    expect(out.changedKeys).toEqual(['place']);   // ageBand unchanged → absent
  });

  it('patches the durable redemption item so the value survives a roster rebuild', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle);
    await callSkill(bundle.agent, 'recordMemberPersonaProperties', {
      groupId: GROUP, memberWebid: BOB, personaProperties: { place: 'Utrecht' },
    });

    // The durable backing (redemption-item source) carries it, independent of the live row.
    const items = await bundle.itemStore.listOpen({ type: 'membership-redemption' });
    const bobItem = items.find((i) => i?.source?.redeemedBy === BOB && i?.source?.groupId === GROUP);
    expect(bobItem?.source?.personaProperties).toEqual({ place: 'Utrecht' });

    // Simulate a rebuild: blank the live row → listGroupMembers backfills from the patched trail.
    await bundle.members.addMember({ webid: BOB, personaProperties: null });
    const list = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    expect(list.members.find((m) => m.webid === BOB)?.personaProperties).toEqual({ place: 'Utrecht' });
  });

  it('overwrites a prior disclosure and an empty {} clears it', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle, { place: 'Groningen', role: 'buur' });

    await callSkill(bundle.agent, 'recordMemberPersonaProperties', { groupId: GROUP, memberWebid: BOB, personaProperties: { place: 'Rotterdam' } });
    expect((await bundle.members.resolveByWebid(BOB)).personaProperties).toEqual({ place: 'Rotterdam' });

    await callSkill(bundle.agent, 'recordMemberPersonaProperties', { groupId: GROUP, memberWebid: BOB, personaProperties: {} });
    const list = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP });
    // {} = "I now share nothing here" — not surfaced (treated as nothing, like a no-disclosure member).
    expect(list.members.find((m) => m.webid === BOB)?.personaProperties ?? null).toBeNull();
  });

  it('refuses to mint a phantom row for a non-member (self-asserted, existing-only)', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle);
    const out = await callSkill(bundle.agent, 'recordMemberPersonaProperties', {
      groupId: GROUP, memberWebid: NOBODY, personaProperties: { place: 'X' },
    });
    expect(out.ok).toBe(false);
    expect(out.reason).toBe('not-a-member');
    expect(await bundle.members.resolveByWebid(NOBODY)).toBeFalsy();
  });

  it('guards missing args', async () => {
    const bundle = await buildBundle();
    await joinBob(bundle);
    expect((await callSkill(bundle.agent, 'recordMemberPersonaProperties', { personaProperties: {} })).reason).toBe('groupId-required');
    expect((await callSkill(bundle.agent, 'recordMemberPersonaProperties', { groupId: GROUP })).reason).toBe('personaProperties-required');
  });
});
