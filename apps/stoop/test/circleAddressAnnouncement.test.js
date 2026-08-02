/**
 * Recording an ANNOUNCED per-circle address (B2, 2026-08-02) — the substrate half.
 *
 * A join teaches two devices about each other and nobody else. `recordCircleAddressAnnouncement` is
 * where the missing fact lands for everyone else: "member X answers at address A in circle C, and
 * here is a signature by the key behind A". It is the same deny-by-default proof the join uses
 * (`verifyCircleLink`, via `verifyCircleAddressAnnouncement`), which is what lets the ADMIN carry a
 * member's announcement to someone who was not present — without the admin becoming someone whose
 * word about an address has to be trusted.
 *
 * Two properties are worth more than the rest here:
 *   • it PATCHES the existing trail row rather than appending a second one. `deriveRoster` merges
 *     rows first-non-null-wins, so an appended row carrying a NEW address would lose to the stale
 *     one it was meant to replace — the re-announce would silently do nothing.
 *   • a REMOTE caller can only ever update their OWN row, and only if that row already exists.
 *     Otherwise `visibility:'authenticated'` would let any authenticated peer write themselves into
 *     a circle they were never admitted to.
 */
import { describe, it, expect } from 'vitest';
import {
  AgentIdentity, InternalBus, InternalTransport, DataPart,
  deriveCircleAddress, signCircleLinkFromSeed,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';
import { resolveMemberAddress, ADDRESS_VIA } from '../src/lib/memberAddress.js';

const CIRCLE = 'buurt-42';
const ME     = 'pk-me';         // this device (webid === the chat signing key)
const BRAM   = 'pk-bram';       // a co-member we joined alongside
const ADMIN  = 'pk-admin';

const seedOf = (n) => new Uint8Array(32).fill(n);
const addressOf = (n, circle = CIRCLE) => deriveCircleAddress(seedOf(n), circle);
const proofOf = (n, circle = CIRCLE, addr = null) =>
  signCircleLinkFromSeed(seedOf(n), circle, circle, addr ?? deriveCircleAddress(seedOf(n), circle));

const BRAM_SEED = 3;
const ADMIN_SEED = 7;

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: CIRCLE, localActor: ME, peers: [] },
    members: [],
    reliableSend: async () => ({ held: false, delivered: true }),
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/** `from` defaults to ME — the LOCAL actor, i.e. the peer bridge calling in after verifying. */
async function callSkill(agent, skillId, args, from = ME) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent, envelope: null });
}

/** This device's own mirror of the peer-confirmed join — the row that makes BRAM/ADMIN members. */
async function recordJoin(bundle, over = {}) {
  return callSkill(bundle.agent, 'recordRemoteRedemption', {
    groupId: CIRCLE, code: 'ABC', codeId: 'admin-item-1', confirmedBy: ADMIN, ...over,
  });
}

async function rowFor(bundle, webid) {
  const roster = await callSkill(bundle.agent, 'listGroupMembers', { groupId: CIRCLE });
  return (roster.members ?? []).find((m) => m.webid === webid) ?? null;
}

const announce = (bundle, over = {}, from = ME) => callSkill(bundle.agent, 'recordCircleAddressAnnouncement', {
  groupId: CIRCLE,
  memberWebid: BRAM,
  circleAddress: addressOf(BRAM_SEED),
  circleAddressProof: proofOf(BRAM_SEED),
  ...over,
}, from);

describe('recordCircleAddressAnnouncement — the receive half of per-circle address announcing', () => {
  it('records a PROVEN address for a member this device only knew as an intro', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });
    // Before: a member with no address at all — the exact state that made joiner↔joiner fail.
    expect((await rowFor(bundle, BRAM))?.circleAddress).toBeUndefined();

    const res = await announce(bundle);
    expect(res.ok).toBe(true);

    const row = await rowFor(bundle, BRAM);
    expect(row.circleAddress).toBe(addressOf(BRAM_SEED));
    // The key must land WITH the address: `bindCircleAddressKeys` silently skips a row carrying one
    // without the other, so a half-written row is an address that can never be sealed to.
    expect(row.pubKey).toBe(BRAM);
    // …and the proof is kept, so this device can relay the fact on to a member who joins later.
    expect(row.circleAddressProof).toBe(proofOf(BRAM_SEED));
  });

  it('the recorded address is what the send path actually resolves, with the fallback OFF', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });
    await announce(bundle);

    const resolved = await resolveMemberAddress(await rowFor(bundle, BRAM), {
      circleId: CIRCLE, preferCircleAddress: true, allowFallback: false,
    });
    expect(resolved.via).toBe(ADDRESS_VIA.CIRCLE);
    expect(resolved.addr).toBe(addressOf(BRAM_SEED));
  });

  it('REFUSES an unproven address — and says so, rather than silently doing nothing', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });

    const res = await announce(bundle, { circleAddressProof: undefined });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('unproven-address');
    expect((await rowFor(bundle, BRAM))?.circleAddress).toBeUndefined();
  });

  it('REFUSES an address whose proof was signed by someone else — seeing an address is not holding it', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });

    const res = await announce(bundle, {
      circleAddressProof: signCircleLinkFromSeed(seedOf(99), CIRCLE, CIRCLE, addressOf(BRAM_SEED)),
    });
    expect(res.ok).toBe(false);
    expect((await rowFor(bundle, BRAM))?.circleAddress).toBeUndefined();
  });

  it('REFUSES a proof minted for a DIFFERENT circle (no cross-circle replay)', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });

    const elsewhere = addressOf(BRAM_SEED, 'werk-7');
    const res = await announce(bundle, {
      circleAddress: elsewhere,
      circleAddressProof: proofOf(BRAM_SEED, 'werk-7', elsewhere),
    });
    expect(res.ok).toBe(false);
    expect((await rowFor(bundle, BRAM))?.circleAddress).toBeUndefined();
  });

  it('a RE-ANNOUNCE replaces the address in place — the roster does not keep serving the old one', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });
    await announce(bundle);
    expect((await rowFor(bundle, BRAM)).circleAddress).toBe(addressOf(BRAM_SEED));

    // Bram now answers somewhere else in this circle (a restored profile / a rotation) and proves it.
    const NEXT = 11;
    const res = await announce(bundle, {
      circleAddress: addressOf(NEXT), circleAddressProof: proofOf(NEXT),
    });
    expect(res.ok).toBe(true);
    expect(res.patched).toBeGreaterThanOrEqual(1);

    const row = await rowFor(bundle, BRAM);
    expect(row.circleAddress, 'the NEW address, not the first one that was written').toBe(addressOf(NEXT));
    expect(row.circleAddressProof).toBe(proofOf(NEXT));
  });

  it('re-announcing an UNCHANGED address writes nothing at all', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });
    await announce(bundle);

    const again = await announce(bundle);
    expect(again.ok).toBe(true);
    expect(again.unchanged).toBe(true);
    expect(again.patched).toBe(0);
    expect(again.created).toBe(0);
  });

  it('the ADMIN — known only as `confirmedBy` — can re-announce, and their row follows', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle, {
      confirmedByCircleAddress: addressOf(ADMIN_SEED),
      confirmedByCircleAddressProof: proofOf(ADMIN_SEED),
    });
    expect((await rowFor(bundle, ADMIN)).circleAddress).toBe(addressOf(ADMIN_SEED));

    // A joiner has no `redeemedBy` row for the admin at all — only the `confirmedBy` half of their
    // own. An announce that patched the first shape only would appear to work and change nothing.
    const NEXT = 13;
    const res = await announce(bundle, {
      memberWebid: ADMIN, circleAddress: addressOf(NEXT), circleAddressProof: proofOf(NEXT),
    });
    expect(res.ok).toBe(true);
    expect((await rowFor(bundle, ADMIN)).circleAddress).toBe(addressOf(NEXT));
  });

  it('the local carrier may introduce a member nobody here has seen — that is the join-time relay', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    expect(await rowFor(bundle, BRAM)).toBeNull();

    const res = await announce(bundle);            // from === ME, the local peer bridge
    expect(res.ok).toBe(true);
    expect(res.created).toBe(1);
    expect((await rowFor(bundle, BRAM)).circleAddress).toBe(addressOf(BRAM_SEED));
  });

  it('a REMOTE caller may only write their OWN row — `memberWebid` is ignored, never honoured', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });

    // A remote peer naming SOMEONE ELSE's row: refused outright rather than silently redirected.
    const res = await announce(bundle, {}, 'pk-someone-else');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('may-only-write-own-row');
    expect((await rowFor(bundle, BRAM))?.circleAddress).toBeUndefined();
  });

  it('a REMOTE non-member cannot announce themselves INTO the circle', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);

    const STRANGER_SEED = 23;
    const res = await callSkill(bundle.agent, 'recordCircleAddressAnnouncement', {
      groupId: CIRCLE,
      circleAddress: addressOf(STRANGER_SEED),
      circleAddressProof: proofOf(STRANGER_SEED),
    }, 'pk-stranger');
    expect(res.ok).toBe(false);
    expect(res.reason).toBe('not-a-member');
    expect(await rowFor(bundle, 'pk-stranger')).toBeNull();
  });

  it('a REMOTE member CAN re-announce their own address (the ordinary re-announce over the wire)', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });

    const res = await callSkill(bundle.agent, 'recordCircleAddressAnnouncement', {
      groupId: CIRCLE,
      circleAddress: addressOf(BRAM_SEED),
      circleAddressProof: proofOf(BRAM_SEED),
    }, BRAM);
    expect(res.ok).toBe(true);
    expect((await rowFor(bundle, BRAM)).circleAddress).toBe(addressOf(BRAM_SEED));
  });
});

describe('broadcastCircleAddresses — the send half', () => {
  it('refuses to put an unprovable announcement on the wire at all', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    const res = await callSkill(bundle.agent, 'broadcastCircleAddresses', {
      groupId: CIRCLE,
      announcements: [{
        circleId: CIRCLE, memberWebid: BRAM,
        circleAddress: addressOf(BRAM_SEED), circleAddressProof: 'nonsense',
      }],
    });
    expect(res.error).toBe('no-proven-announcements');
  });

  it('fans the proven ones (and only those) to the circle', async () => {
    const bundle = await buildBundle();
    await recordJoin(bundle);
    await callSkill(bundle.agent, 'recordPeerIntro', { groupId: CIRCLE, peerAddr: BRAM });
    await announce(bundle);

    const res = await callSkill(bundle.agent, 'broadcastCircleAddresses', {
      groupId: CIRCLE,
      announcements: [
        { circleId: CIRCLE, memberWebid: BRAM, circleAddress: addressOf(BRAM_SEED), circleAddressProof: proofOf(BRAM_SEED) },
        { circleId: CIRCLE, memberWebid: 'pk-nobody', circleAddress: addressOf(31), circleAddressProof: 'forged' },
      ],
    });
    expect(res.error).toBeUndefined();
    expect(res.attempted, 'the circle had members to fan to').toBeGreaterThan(0);
  });
});
