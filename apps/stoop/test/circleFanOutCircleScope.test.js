/**
 * Circle fan-out RECIPIENTS — the roster of THIS circle, not the device's global MemberMap.
 *
 * Found on hardware 2026-07-30: a phone's circle chat never reached the circle's other member, while
 * the same phone happily held five messages for dead peers of long-abandoned test circles. Both halves
 * came from one line — `broadcastToCircle` fanned over `MemberMap.list()`:
 *
 *   • the MemberMap carries NO circle on a row, so every circle's message was addressed to every member
 *     of every OTHER circle this device ever admitted (and those rows persist across restarts), and
 *   • a member this device knows only from the durable membership trail was never addressed at all.
 *     That is a JOINER's normal state: `recordRemoteRedemption` writes only the joiner's own row, so the
 *     admin exists solely as `confirmedBy` on the trail. Hence joiner→admin chat silently never left the
 *     device while admin→joiner worked, and catch-up (roster-driven) reached the peer chat could not.
 *
 * The fix routes the fan through the SAME per-circle projection `listGroupMembers` already returned
 * (`projectCircleRoster` → `deriveRoster` over the trail), so the two can't drift again.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';

// basis circles bind webid === the member's chat pubKey, so these read like real rows.
const ME       = 'pk-me';
const OLD_PEER = 'pk-old-peer';     // joined an EARLIER circle; still in this device's MemberMap
const CO       = 'pk-co-member';    // a member of the circle under test
const ADMIN    = 'pk-admin';        // the circle's founder, as a JOINER sees them (confirmedBy only)

/** A bundle whose reliable sender (the fan choke) records the addresses it is handed. */
async function buildBundle({ members, sends }) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'circle-b', localActor: ME, peers: [] },
    members,
    reliableSend: async (addr) => { sends.push(addr); return { held: false, delivered: true }; },
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, from = ME) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

/** A `membership-redemption` trail row (the durable, signed source of membership). */
const redemption = (source) => ({
  type: 'membership-redemption', text: 'joined', visibility: 'household', source,
});

describe('circle fan-out — recipients are the circle roster, not the global MemberMap', () => {
  it('does NOT address a member who belongs to a DIFFERENT circle', async () => {
    const sends = [];
    const bundle = await buildBundle({
      sends,
      members: [
        { webid: ME,       role: 'admin',  pubKey: ME },
        { webid: OLD_PEER, role: 'member', pubKey: OLD_PEER, circleAddress: 'addr-old-in-a' },
        { webid: CO,       role: 'member', pubKey: CO,       circleAddress: 'addr-co-in-b' },
      ],
    });
    await bundle.itemStore.addItems([
      redemption({ groupId: 'circle-a', redeemedBy: OLD_PEER, signingPublicKey: OLD_PEER, circleAddress: 'addr-old-in-a' }),
      redemption({ groupId: 'circle-b', redeemedBy: CO,       signingPublicKey: CO,       circleAddress: 'addr-co-in-b' }),
    ], { actor: ME });

    const r = await callSkill(bundle.agent, 'broadcastCircleChatStatement',
      { groupId: 'circle-b', event: { body: { hash: 'h' }, sig: 's' }, msgId: 'm-scope-1', ts: 1 });

    expect(sends).toEqual(['addr-co-in-b']);
    expect(r.attempted).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it('DOES address a member known only from the trail (a joiner\'s view of the admin)', async () => {
    const sends = [];
    // The joiner's MemberMap knows nothing about this circle — only a leftover row from an older one.
    const bundle = await buildBundle({
      sends,
      members: [
        { webid: ME,       role: 'admin',  pubKey: ME },
        { webid: OLD_PEER, role: 'member', pubKey: OLD_PEER, circleAddress: 'addr-old-in-a' },
      ],
    });
    await bundle.itemStore.addItems([
      redemption({ groupId: 'circle-a', redeemedBy: OLD_PEER, signingPublicKey: OLD_PEER, circleAddress: 'addr-old-in-a' }),
      // My own joiner-side mirror: the admin appears ONLY as `confirmedBy` on a `channel:'peer'` row.
      redemption({ groupId: 'circle-b', redeemedBy: ME, confirmedBy: ADMIN, channel: 'peer' }),
    ], { actor: ME });

    // The roster skill has always seen the admin; the fan must address exactly the same set.
    const roster = await callSkill(bundle.agent, 'listGroupMembers', { groupId: 'circle-b' });
    expect((roster.members ?? []).map((m) => m.webid)).toContain(ADMIN);

    const r = await callSkill(bundle.agent, 'broadcastCircleChatStatement',
      { groupId: 'circle-b', event: { body: { hash: 'h' }, sig: 's' }, msgId: 'm-scope-2', ts: 1 });

    // No per-circle address is knowable for the founder (the joiner's trail never carries one), so this
    // rides the webid rung of the address ladder — the admin's canonical address, which IS routable.
    expect(sends).toEqual([ADMIN]);
    expect(r.attempted).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it('a circle with NO trail keeps the legacy full-MemberMap fan (back-compat)', async () => {
    const sends = [];
    const bundle = await buildBundle({
      sends,
      members: [
        { webid: ME, role: 'admin',  pubKey: ME },
        { webid: CO, role: 'member', pubKey: CO },
      ],
    });

    const r = await callSkill(bundle.agent, 'broadcastCircleChatStatement',
      { groupId: 'seeded-buurt', event: { body: { hash: 'h' }, sig: 's' }, msgId: 'm-scope-3', ts: 1 });

    expect(sends).toEqual([CO]);
    expect(r.attempted).toBe(1);
  });
});
