// Persona share-to-circle across THREE members — stories 9.3 + 9.4 of
// `plans/NOTE-multi-device-user-stories.md`.
//
// `recordMemberPersonaProperties` is a REPEATED-WRITE path: a member pushes their persona to a circle, then
// pushes an updated one, and other members push theirs in the same window. Every bug found on 2026-07-26 was
// this shape — a second operation re-deriving from a partial base and silently dropping the first — so this
// is where the corpus looks next. The op reads the previous value, diffs it, then writes BOTH the MemberMap
// row and the durable redemption item.
//
// Cast: Anna (admin) · Bram · Cato (the two members pushing personas).
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

const ADMIN = 'https://id.example/anna';
const BRAM  = 'https://id.example/bram';
const CATO  = 'https://id.example/cato';
const GROUP = 'oosterpoort';
const RULES = { purpose: 'buurt', admins: [ADMIN], houseRules: ['wees aardig'] };

async function callSkill(agent, skillId, args, from = ADMIN) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

async function circleWithMembers() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: GROUP, localActor: ADMIN, peers: [] },
    members: [{ webid: ADMIN, role: 'admin' }],
  });
  await bundle.offeringMatch.start();
  const r = await callSkill(bundle.agent, 'createGroupV2', { groupId: GROUP, name: 'X', rules: RULES });
  await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, BRAM);
  await callSkill(bundle.agent, 'redeemMembershipCode', { groupId: GROUP, code: r.code }, CATO);
  return bundle;
}

/** The persona properties the ADMIN's roster currently holds for a member. */
async function rosterProps(bundle, webid) {
  const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
  return out.members.find((m) => m.webid === webid)?.personaProperties ?? null;
}

/** How many roster rows exist for a member — a repeated push must never mint a second one. */
async function rowCount(bundle, webid) {
  const out = await callSkill(bundle.agent, 'listGroupMembers', { groupId: GROUP }, ADMIN);
  return out.members.filter((m) => m.webid === webid).length;
}

const share = (bundle, from, personaProperties) =>
  callSkill(bundle.agent, 'recordMemberPersonaProperties', { groupId: GROUP, personaProperties }, from);

describe('9.3 — sharing a persona to the same circle TWICE updates one record', () => {
  it('the second push replaces the first: one row, the newer values, no resurrection of the old', async () => {
    const b = await circleWithMembers();

    await share(b, BRAM, { place: 'Groningen', ageBand: '35-54' });
    expect(await rosterProps(b, BRAM)).toEqual({ place: 'Groningen', ageBand: '35-54' });
    expect(await rowCount(b, BRAM)).toBe(1);

    await share(b, BRAM, { place: 'Assen', ageBand: '35-54' });      // moved house
    expect(await rosterProps(b, BRAM)).toEqual({ place: 'Assen', ageBand: '35-54' });
    expect(await rowCount(b, BRAM)).toBe(1);                          // updated, not duplicated
  });

  it('a re-push of the SAME values is a no-op, not a rewrite', async () => {
    const b = await circleWithMembers();
    const props = { place: 'Groningen' };
    await share(b, BRAM, props);
    const again = await share(b, BRAM, props);
    // The op is diff-gated — an unchanged push reports no changed keys rather than churning the roster.
    expect(again.changedKeys ?? []).toEqual([]);
    expect(await rosterProps(b, BRAM)).toEqual(props);
  });

  it('dropping a property removes it — the old value is not silently retained', async () => {
    const b = await circleWithMembers();
    await share(b, BRAM, { place: 'Groningen', ageBand: '35-54' });
    await share(b, BRAM, { place: 'Groningen' });                     // ageBand withdrawn
    const after = await rosterProps(b, BRAM);
    expect(after).toEqual({ place: 'Groningen' });
    expect(after).not.toHaveProperty('ageBand');                      // a withdrawal must actually withdraw
  });
});

describe('9.4 — two members share personas concurrently', () => {
  it('both land on the admin roster; neither overwrites the other', async () => {
    const b = await circleWithMembers();

    await Promise.all([
      share(b, BRAM, { place: 'Groningen' }),
      share(b, CATO, { place: 'Assen' }),
    ]);

    expect(await rosterProps(b, BRAM)).toEqual({ place: 'Groningen' });
    expect(await rosterProps(b, CATO)).toEqual({ place: 'Assen' });   // ← the clobber shape
  });

  it('a whole batch of concurrent pushes all land (not just a two-way case)', async () => {
    const b = await circleWithMembers();
    await Promise.all([
      share(b, BRAM, { place: 'Groningen', ageBand: '35-54' }),
      share(b, CATO, { place: 'Assen' }),
      share(b, ADMIN, { place: 'Utrecht' }),
    ]);
    expect(await rosterProps(b, BRAM)).toEqual({ place: 'Groningen', ageBand: '35-54' });
    expect(await rosterProps(b, CATO)).toEqual({ place: 'Assen' });
    expect(await rosterProps(b, ADMIN)).toEqual({ place: 'Utrecht' });
  });

  it('a member can only write their OWN row — a push never rewrites someone else', async () => {
    const b = await circleWithMembers();
    await share(b, CATO, { place: 'Assen' });
    // Bram names Cato as the subject; the op defaults the subject to the CALLER, so this must not land
    // on Cato's row (an admin self-update is the only reason `memberWebid` exists).
    await callSkill(b.agent, 'recordMemberPersonaProperties',
      { groupId: GROUP, memberWebid: CATO, personaProperties: { place: 'FORGED' } }, BRAM);
    expect(await rosterProps(b, CATO)).toEqual({ place: 'Assen' });
  });
});
