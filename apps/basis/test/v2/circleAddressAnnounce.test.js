/**
 * basis — the app half of per-circle address announcing (B2), at the seam where the two halves that
 * MUST move together actually move: the address binding and the boundary-authentication snapshot.
 *
 * The end-to-end proof is `circleAddressAnnounce.relay.test.js`. This file pins the properties that
 * an end-to-end pass would not distinguish:
 *
 *   • recording an announcement refreshes BOTH `registerPeerAddress` (what makes an address
 *     sealable) and `recordCircleSenders` (who may speak) — from ONE roster read. Refreshing only
 *     the first produces a member who is reachable and then refused as a stranger, which fails
 *     AFTER appearing to work.
 *   • the trigger is DIFF-GATED, so the steady state is silence rather than an announcement per
 *     boot per circle.
 *   • an unprovable announcement causes no write and no refresh at all.
 */
import { describe, it, expect, vi } from 'vitest';
import { deriveCircleAddress, signCircleLinkFromSeed } from '@onderling/core';
import {
  announceOwnCircleAddress, announceOwnCircleAddressIfChanged, announcementsFromRoster,
  propagateCircleAddressesAfterJoin, makeCircleAddressAnnouncePeerHandler,
  isValidCircleAddressAnnounceEnvelope, CIRCLE_ADDRESS_ANNOUNCE_KIND,
} from '../../src/v2/circleAddressAnnounce.js';

const CIRCLE = 'circle-42';
const QUIET = { warn() {}, info() {} };

const seedOf = (n) => new Uint8Array(32).fill(n);
const addressOf = (n, circle = CIRCLE) => deriveCircleAddress(seedOf(n), circle);
const proofOf = (n, circle = CIRCLE) =>
  signCircleLinkFromSeed(seedOf(n), circle, circle, deriveCircleAddress(seedOf(n), circle));

const ME = 'pk-me';
const BRAM = 'pk-bram';
const CATO = 'pk-cato';
const MY_SEED = 5;

/**
 * A host agent with exactly the seams this module reaches for. `rows` is LIVE: a recorded
 * announcement mutates it, the way the substrate's own roster would, so the refresh that follows
 * reads the post-write state — which is the whole property under test.
 */
function fakeAgent({ rows = [], selfWebid = ME, seed = MY_SEED } = {}) {
  const log = { skills: [], registered: [], snapshots: [], peerSends: [] };
  const agent = {
    identity: { chat: { pubKey: selfWebid } },
    circleAddressFor: (cid) => deriveCircleAddress(seedOf(seed), cid),
    signCircleLink:   (cid, gid, addr) => signCircleLinkFromSeed(seedOf(seed), cid, gid, addr),
    registerPeerAddress: (address, pubKey, opts) => { log.registered.push({ address, pubKey, opts }); return true; },
    recordCircleSenders: async ({ circleId, members }) => {
      log.snapshots.push({ circleId, keys: members.map((m) => m.circleAddress ?? m.pubKey) });
      return members.length;
    },
    sendPeerMessage: async (to, payload) => { log.peerSends.push({ to, payload }); return { delivered: true }; },
    callSkill: async (app, op, args) => {
      log.skills.push({ op, args });
      if (op === 'listGroupMembers') return { members: rows };
      if (op === 'recordCircleAddressAnnouncement') {
        // Stand in for the substrate write: upsert the row, exactly as the real skill does.
        const existing = rows.find((r) => r.webid === args.memberWebid);
        if (existing) Object.assign(existing, { circleAddress: args.circleAddress, circleAddressProof: args.circleAddressProof });
        else rows.push({ webid: args.memberWebid, pubKey: args.memberWebid, circleAddress: args.circleAddress, circleAddressProof: args.circleAddressProof });
        return { ok: true };
      }
      if (op === 'broadcastCircleAddresses') return { sent: 2, attempted: 2, errors: [] };
      return {};
    },
  };
  return { agent, log, rows };
}

const opsCalled = (log) => log.skills.map((s) => s.op);

describe('announcing my own per-circle address', () => {
  it('announces when the circle\'s roster does not yet say where I am', async () => {
    const { agent, log } = fakeAgent({ rows: [{ webid: ME, pubKey: ME }, { webid: BRAM, pubKey: BRAM }] });

    const res = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: null, onWarn: () => {} });
    expect(res.announced).toBe(true);
    expect(opsCalled(log)).toContain('broadcastCircleAddresses');

    // What went on the wire is MY address, proven — nothing else is announceable by me.
    const fan = log.skills.find((s) => s.op === 'broadcastCircleAddresses');
    expect(fan.args.announcements).toEqual([{
      circleId: CIRCLE, memberWebid: ME,
      circleAddress: addressOf(MY_SEED), circleAddressProof: proofOf(MY_SEED),
    }]);
  });

  it('says NOTHING when my row already carries the address I derive — the steady state is silence', async () => {
    const rows = [{ webid: ME, pubKey: ME, circleAddress: addressOf(MY_SEED), circleAddressProof: proofOf(MY_SEED) }];
    const { agent, log } = fakeAgent({ rows });

    const res = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: rows, onWarn: () => {} });
    expect(res.announced).toBe(false);
    expect(res.reason).toBe('unchanged');
    expect(opsCalled(log)).not.toContain('broadcastCircleAddresses');
    // Not even a roster read: the caller already had the rows.
    expect(log.skills).toHaveLength(0);
  });

  it('announces when the roster carries a DIFFERENT address for me (a rotation / a restored profile)', async () => {
    const rows = [{ webid: ME, pubKey: ME, circleAddress: addressOf(99), circleAddressProof: proofOf(99) }];
    const { agent } = fakeAgent({ rows });
    const res = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: rows, onWarn: () => {} });
    expect(res.announced).toBe(true);
  });

  it('announces when my row has an address but NO proof — an unrelayable row is not "known"', async () => {
    const rows = [{ webid: ME, pubKey: ME, circleAddress: addressOf(MY_SEED) }];
    const { agent } = fakeAgent({ rows });
    const res = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: rows, onWarn: () => {} });
    expect(res.announced).toBe(true);
  });

  it('records my own announcement locally as well as fanning it — or every boot would re-announce', async () => {
    const rows = [{ webid: ME, pubKey: ME }];
    const { agent, log } = fakeAgent({ rows });
    await announceOwnCircleAddress({ agent, circleId: CIRCLE, logger: QUIET });

    expect(opsCalled(log)).toContain('recordCircleAddressAnnouncement');
    expect(rows[0].circleAddress).toBe(addressOf(MY_SEED));
    // …and the very next trigger is therefore quiet.
    const again = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: rows, onWarn: () => {} });
    expect(again.announced).toBe(false);
  });

  it('a fan that left someone out does NOT record my row — or the trigger would go silent for good', async () => {
    const rows = [{ webid: ME, pubKey: ME }, { webid: BRAM, pubKey: BRAM }];
    const { agent, log } = fakeAgent({ rows });
    // The boot case this exists for: the transport is not up yet, so the fan reports a recipient it
    // could not reach. Recording my row here would make every later boot think the circle knows.
    agent.callSkill = async (app, op, args) => {
      log.skills.push({ op, args });
      if (op === 'listGroupMembers') return { members: rows };
      if (op === 'broadcastCircleAddresses') {
        return { sent: 0, attempted: 1, errors: [{ webid: BRAM, reason: 'recipient-pubkey-unknown' }] };
      }
      return {};
    };
    const res = await announceOwnCircleAddress({ agent, circleId: CIRCLE, logger: QUIET });
    expect(res.reached).toBe(false);
    expect(opsCalled(log)).not.toContain('recordCircleAddressAnnouncement');
    expect(rows[0].circleAddress).toBeUndefined();
    // …so the next boot tries again.
    const again = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: rows, onWarn: () => {} });
    expect(again.announced).toBe(true);
  });

  it('a device that cannot prove an address announces nothing', async () => {
    const { log } = fakeAgent();
    const agent = { identity: { chat: { pubKey: ME } }, callSkill: async () => ({}), circleAddressFor: () => null };
    const res = await announceOwnCircleAddressIfChanged({ agent, circleId: CIRCLE, members: [], onWarn: () => {} });
    expect(res.announced).toBe(false);
    expect(res.reason).toBe('no-provable-address');
    expect(log.skills).toHaveLength(0);
  });
});

describe('receiving an announcement', () => {
  const envelopeOf = (announcements, circleId = CIRCLE) => ({
    subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND, circleId, msgId: 'ca-1', ts: Date.now(), announcements,
  });
  const bramAnnouncement = {
    circleId: CIRCLE, memberWebid: BRAM, circleAddress: addressOf(3), circleAddressProof: proofOf(3),
  };

  it('records the address AND refreshes both the binding and the authorize snapshot, from one read', async () => {
    const rows = [{ webid: ME, pubKey: ME }, { webid: BRAM, pubKey: BRAM }];
    const { agent, log } = fakeAgent({ rows });

    const handler = makeCircleAddressAnnouncePeerHandler({ agent, logger: QUIET });
    const res = await handler('pk-admin', envelopeOf([bramAnnouncement]));
    expect(res).toEqual({ recorded: 1, refused: 0 });

    // The address became sealable…
    expect(log.registered).toContainEqual({
      address: addressOf(3), pubKey: BRAM, opts: { signingKey: addressOf(3) },
    });
    // …and the same key became ALLOWED TO SPEAK. Without this, bram is now addressable and every
    // envelope he sends is refused with SENDER_NOT_AUTHORIZED — a failure that appears only later.
    expect(log.snapshots).toHaveLength(1);
    expect(log.snapshots[0].circleId).toBe(CIRCLE);
    expect(log.snapshots[0].keys).toContain(addressOf(3));

    // ONE roster read backs both, not two.
    expect(opsCalled(log).filter((op) => op === 'listGroupMembers')).toHaveLength(1);
  });

  it('an unprovable announcement writes nothing and refreshes nothing', async () => {
    const rows = [{ webid: ME, pubKey: ME }, { webid: BRAM, pubKey: BRAM }];
    const { agent, log } = fakeAgent({ rows });

    const handler = makeCircleAddressAnnouncePeerHandler({ agent, logger: QUIET });
    const res = await handler('pk-admin', envelopeOf([{ ...bramAnnouncement, circleAddressProof: 'forged' }]));
    expect(res).toEqual({ recorded: 0, refused: 1 });
    expect(opsCalled(log)).not.toContain('recordCircleAddressAnnouncement');
    expect(log.snapshots).toHaveLength(0);
    expect(rows[1].circleAddress).toBeUndefined();
  });

  it('an announcement for ANOTHER circle riding this circle\'s fan is refused', async () => {
    const { agent, log } = fakeAgent({ rows: [{ webid: ME, pubKey: ME }] });
    const handler = makeCircleAddressAnnouncePeerHandler({ agent, logger: QUIET });
    // Valid in its own circle; presented here under `circleId: CIRCLE`.
    const elsewhere = {
      circleId: 'werk-7', memberWebid: BRAM,
      circleAddress: addressOf(3, 'werk-7'),
      circleAddressProof: signCircleLinkFromSeed(seedOf(3), 'werk-7', 'werk-7', addressOf(3, 'werk-7')),
    };
    const res = await handler('pk-admin', envelopeOf([elsewhere]));
    expect(res.recorded).toBe(0);
    expect(log.snapshots).toHaveLength(0);
  });

  it('a mixed batch keeps the good and drops the bad', async () => {
    const rows = [{ webid: ME, pubKey: ME }];
    const { agent } = fakeAgent({ rows });
    const handler = makeCircleAddressAnnouncePeerHandler({ agent, logger: QUIET });
    const res = await handler('pk-admin', envelopeOf([
      bramAnnouncement,
      { circleId: CIRCLE, memberWebid: CATO, circleAddress: addressOf(4), circleAddressProof: 'nope' },
    ]));
    expect(res).toEqual({ recorded: 1, refused: 1 });
    expect(rows.find((r) => r.webid === BRAM)).toBeTruthy();
    expect(rows.find((r) => r.webid === CATO)).toBeFalsy();
  });

  it('a malformed envelope is dropped without touching anything', async () => {
    const { agent, log } = fakeAgent();
    const handler = makeCircleAddressAnnouncePeerHandler({ agent, logger: QUIET });
    for (const bad of [null, {}, { subtype: CIRCLE_ADDRESS_ANNOUNCE_KIND }, envelopeOf([])]) {
      expect(await handler('x', bad)).toEqual({ recorded: 0, refused: 0 });
    }
    expect(log.skills).toHaveLength(0);
    expect(isValidCircleAddressAnnounceEnvelope(envelopeOf([bramAnnouncement]))).toBe(true);
  });
});

describe('the admin\'s post-join propagation', () => {
  it('tells the settled members about the newcomer, and the newcomer about them — on the channel that works', async () => {
    const rows = [
      { webid: ME, pubKey: ME },                                                                  // the admin (us)
      { webid: BRAM, pubKey: BRAM, circleAddress: addressOf(3), circleAddressProof: proofOf(3) }, // settled
      { webid: CATO, pubKey: CATO, circleAddress: addressOf(4), circleAddressProof: proofOf(4) }, // just joined
    ];
    const { agent, log } = fakeAgent({ rows });

    const out = await propagateCircleAddressesAfterJoin({
      agent, circleId: CIRCLE, newMemberWebid: CATO, logger: QUIET,
    });

    // 1. The newcomer's address goes to the settled members over the circle fan — narrowed to them,
    //    because the newcomer's own per-circle address is not registered yet.
    const fan = log.skills.find((s) => s.op === 'broadcastCircleAddresses');
    expect(fan.args.announcements.map((a) => a.memberWebid)).toEqual([CATO]);
    expect(fan.args.to).toEqual([BRAM]);
    expect(out.toCircle).toBe(2);

    // 2. The circle's addresses go to the NEWCOMER over the direct peer channel the redeem response
    //    just used — their per-circle address is not listening yet, their global one demonstrably is.
    expect(log.peerSends).toHaveLength(1);
    expect(log.peerSends[0].to).toBe(CATO);
    expect(log.peerSends[0].payload.subtype).toBe(CIRCLE_ADDRESS_ANNOUNCE_KIND);
    expect(log.peerSends[0].payload.announcements.map((a) => a.memberWebid)).toEqual([BRAM]);
    // Housekeeping must never wake a phone.
    expect(log.peerSends[0].payload.noWake).toBe(true);

    // …and the newcomer's freshly-recorded address was BOUND before any of that was sent, or the
    // fan above would have been aimed at an address this device cannot seal to.
    expect(log.registered.some((r) => r.address === addressOf(4))).toBe(true);
    expect(opsCalled(log)[0]).toBe('listGroupMembers');
  });

  it('relays only what it can PROVE — a member whose row carries no proof is skipped, not sent unproven', () => {
    const rows = [
      { webid: BRAM, pubKey: BRAM, circleAddress: addressOf(3), circleAddressProof: proofOf(3) },
      { webid: CATO, pubKey: CATO, circleAddress: addressOf(4) },   // pre-2026-08-02 row: no proof
      { webid: 'pk-old', pubKey: 'pk-old' },                        // never presented an address
    ];
    expect(announcementsFromRoster({ members: rows, circleId: CIRCLE }).map((a) => a.memberWebid))
      .toEqual([BRAM]);
    expect(announcementsFromRoster({ members: rows, circleId: CIRCLE, exceptWebid: BRAM })).toEqual([]);
  });

  it('a roster that cannot be read propagates nothing rather than half of something', async () => {
    const agent = {
      identity: { chat: { pubKey: ME } },
      registerPeerAddress: () => true,
      callSkill: vi.fn(async (app, op) => {
        if (op === 'listGroupMembers') throw new Error('substrate down');
        return {};
      }),
    };
    const out = await propagateCircleAddressesAfterJoin({
      agent, circleId: CIRCLE, newMemberWebid: CATO, logger: QUIET,
    });
    expect(out).toEqual({ toCircle: 0, toNewMember: 0, announced: 0 });
  });
});
