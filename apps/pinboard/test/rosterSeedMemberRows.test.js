/**
 * THE SEED'S MEMBER ROWS ARE DISPLAY FACTS, NOT ROSTER FACTS (2026-09-21). A roster seed carries the sibling's derived
 * roster rows so a seeded device can show names and route before its own fold catches up. It used to write the row's
 * `handle` into the member map too — the JOIN-TIME handle the fold already derives from the seeded trail. The member
 * map is the contact book's row, so a roster fact became the person's handle there: a visitor who joined a pair circle
 * under the pair roster's quiet placeholder ("pujqrnqj") was painted by that placeholder on every contact list the
 * seed reached (found in the box walk the day the siblings started following a circle). A handle is the fold's to say.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalTransport, InternalBus, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';

const CIRCLE = 'pair-seeded';
const ME = 'webid:me'; const SIB = 'webid:me';   // a sibling speaks as the same person
const VISITOR = 'webid:visitor';

async function callSkill(agent, skillId, args, from = ME) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

describe('recordRosterSeed — the member rows', () => {
  it('writes names, keys and addresses into the member map, NEVER the roster\'s handle (the fold has it; the contact row must not)', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
      offeringMatch: { group: CIRCLE, localActor: ME, peers: [] }, members: [],
    });
    await bundle.offeringMatch.start();
    const r = await callSkill(bundle.agent, 'recordRosterSeed', {
      groupId: CIRCLE,
      rows: [{ id: 'red-1', type: 'membership-redemption', text: 'visitor redeemed', source: { groupId: CIRCLE, redeemedBy: VISITOR, confirmedBy: ME, peerDisplay: 'pvisitor' } }],
      members: [{ webid: VISITOR, handle: 'pvisitor', displayName: 'Vera', pubKey: 'pk-visitor', circleAddress: 'visitor@pair' }],
    }, SIB);
    expect(r.membersRecorded).toBe(1);
    const row = await bundle.members.resolveByWebid(VISITOR);
    expect(row.displayName, 'a name someone gave travels').toBe('Vera');
    expect(row.pubKey).toBe('pk-visitor');
    expect(row.handle ?? null, 'the join-time handle stays a roster fact').toBeNull();
  });
});

describe('setContactHidden on a sender the book never held (the delete/hide note §6a-3)', () => {
  it('hides on a placeholder row `{ webid, pubKey: webid }`; showing again keeps the row, unnamed until the ladder names it', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const bundle = await createNeighbourhoodAgent({
      identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
      offeringMatch: { group: CIRCLE, localActor: ME, peers: [] }, members: [],
    });
    await bundle.offeringMatch.start();
    const hid = await callSkill(bundle.agent, 'setContactHidden', { webid: 'stranger', hidden: true });
    expect(hid.contact).toMatchObject({ webid: 'stranger', pubKey: 'stranger', hidden: true });
    const back = await callSkill(bundle.agent, 'setContactHidden', { webid: 'stranger', hidden: false });
    expect(back.contact).toMatchObject({ webid: 'stranger', hidden: false });
    const rows = (await callSkill(bundle.agent, 'listContacts', {})).contacts;
    expect(rows.map((c) => [c.webid, c.hidden, c.displayName ?? null, c.handle ?? null])).toEqual([['stranger', false, null, null]]);
  });
});
