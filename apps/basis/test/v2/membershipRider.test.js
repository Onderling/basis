import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import {
  makeMembershipRail, makeMembershipEmitter, makeMembershipPeerHandler,
  MEMBERSHIP_BROADCAST, MEMBERSHIP_CATCHUP_SUBTYPES,
} from '../../src/v2/membershipRail.js';
import { makeGovernanceCatchUp } from '../../src/v2/governanceCatchUp.js';
import { projectCircleRoster } from '../../../stoop/src/skills/index.js';

// The membership rider's acceptance: membership statements ride the device log's membership lane —
// signed with per-circle keys, fanned + VERIFIED on ingest, pull-all caught-up — and the roster folds them
// AUTHORITATIVELY (the wall-clock exit path is retired). Self-joins carry their redemption proof; an
// unproven join defers; a forged statement never lands; the offline third device converges.

const CIRCLE = 'circle:rider';

function fakeEventLog() {
  const entries = []; const byId = new Set();
  return {
    entries,
    query() { return entries.slice(); },
    appendSilentEntry({ circleId, kind, payload, id, ts }) {
      if (byId.has(id)) return entries.find((e) => e.id === id);
      byId.add(id);
      const entry = { id, type: kind, circleId, payload, ts, silent: true };
      entries.push(entry); return entry;
    },
  };
}

/**
 * The circle store a device's roster projection reads: the redemption trail, PLUS the circle's own
 * `group-rules` item.
 *
 * The rules item carries the circle's POLICY blob. It no longer carries authority: founders are
 * derived from the admission trail's structure — the admitters (`confirmedBy`) who never redeemed —
 * because a store row's `addedBy` is the local recorder on a mirror, not the author.
 *
 * Which is why every redemption row below names its admitter. A real one always does (measured on a
 * live circle: every `channel: 'peer'` row carries `confirmedBy`), and a fixture that omits it is
 * describing a circle nobody ever admitted anyone to.
 */
const FOUNDER = 'webid:admin';

function fakeStore(rows, founder = FOUNDER) {
  const rulesItem = {
    id: 'rules-1', type: 'group-rules', addedBy: founder, addedAt: 1,
    source: { groupId: CIRCLE, rules: { name: CIRCLE }, version: 1 },
  };
  return {
    async listOpen({ type } = {}) {
      if (type === 'membership-redemption') return rows;
      if (type === 'group-rules') return [rulesItem];
      return [];
    },
  };
}

/** A member device: per-circle identity, device log, rail, emitter (fanning over the wire array). */
async function device(ref, rosterAll, wire) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const eventLog = fakeEventLog();
  const row = rosterAll.find((m) => m.webid === ref);
  if (row) row.circleAddress = cid.pubKey;
  // The binding verifier reads the DERIVED roster (listGroupMembers — webid + circleAddress +
  // the proven set + the ceremony address); the routing list (listGroupRoster) stays answered
  // for the fan-out reads.
  const callSkill = async (o, op) => ((op === 'listGroupMembers' || op === 'listGroupRoster')
    ? { members: rosterAll.filter((m) => m.webid !== ref) } : { ok: true });
  const rail = makeMembershipRail({ eventLog, circleIdentityFor: async () => cid, myRef: ref, callSkill });
  const emit = makeMembershipEmitter({
    rail, myRef: ref,
    fan: (circleId, statement) => wire.push({ from: ref, circleId, statement }),
  });
  const receiver = makeMembershipPeerHandler({ rail });
  return { ref, cid, eventLog, rail, emit, receiver };
}

const rosterOf = async (dev, redemptionRows, memberMapList = []) => projectCircleRoster({
  store: fakeStore(redemptionRows), groupId: CIRCLE, memberMapList,
  membershipRead: (circleId) => dev.rail.readVerifiedBodies(circleId),
});
const webids = (roster) => (roster ?? []).map((r) => r.webid).sort();

describe('the membership rider — statements on the device log, roster folds them authoritatively', () => {
  it('join-with-proof admits; a self-join WITHOUT its redemption row defers (deny-favouring)', async () => {
    const rosterAll = [{ webid: 'webid:admin', role: 'admin' }, { webid: 'webid:mel', role: 'member' }];
    const wire = [];
    const admin = await device('webid:admin', rosterAll, wire);
    const mel = await device('webid:mel', rosterAll, wire);
    const rows = [{ id: 'red-1', source: { groupId: CIRCLE, redeemedBy: 'webid:mel', confirmedBy: FOUNDER, redeemedAt: 1000 } }];
    const memberMap = [{ webid: 'webid:admin', role: 'admin' }];

    // mel's join carries its redemption proof → admitted on her own device's fold.
    await mel.emit({ kind: 'join', circleId: CIRCLE, subject: 'webid:mel', payload: { redemptionRef: 'red-1' } });
    expect(webids(await rosterOf(mel, rows, memberMap))).toEqual(['webid:admin', 'webid:mel']);

    // A self-join whose row is NOT known here (e.g. the trail hasn't arrived) defers — never forges in.
    const ghost = await device('webid:ghost', [...rosterAll, { webid: 'webid:ghost', role: 'member' }], wire);
    await admin.receiver(null, {
      subtype: MEMBERSHIP_BROADCAST, circleId: CIRCLE,
      event: signSpine(ghost.cid, { kind: 'join', circleId: CIRCLE, subject: 'webid:ghost', payload: { redemptionRef: 'red-nope', authorRef: 'webid:ghost' }, parent: null }),
    });
    const adminView = await rosterOf(admin, rows, memberMap);
    expect(webids(adminView)).not.toContain('webid:ghost');   // no matching row → deferred, not admitted
  });

  it('an EVICT fans to an online member, verifies at their rail, and folds the member OUT (no wall-clock)', async () => {
    const rosterAll = [{ webid: 'webid:admin', role: 'admin' }, { webid: 'webid:mel', role: 'member' }, { webid: 'webid:bob', role: 'member' }];
    const wire = [];
    const admin = await device('webid:admin', rosterAll, wire);
    const bob = await device('webid:bob', rosterAll, wire);
    const rows = [
      { id: 'red-mel', source: { groupId: CIRCLE, redeemedBy: 'webid:mel', confirmedBy: FOUNDER, redeemedAt: 1000 } },
      { id: 'red-bob', source: { groupId: CIRCLE, redeemedBy: 'webid:bob', confirmedBy: FOUNDER, redeemedAt: 1000 } },
    ];
    const memberMap = [{ webid: 'webid:admin', role: 'admin' }];

    await admin.emit({ kind: 'evict', circleId: CIRCLE, subject: 'webid:mel' });
    for (const w of wire) await bob.receiver(null, { subtype: MEMBERSHIP_BROADCAST, circleId: w.circleId, event: w.statement });

    const bobView = await rosterOf(bob, rows, memberMap);
    expect(webids(bobView)).toEqual(['webid:admin', 'webid:bob']);   // mel folded out on BOB's device
    // The statement passed the FULL gate: signed, declared kind, admin's key↔ref binding via the roster row.
    expect(bob.eventLog.entries.every((e) => e.payload.sig)).toBe(true);
  });

  it('a FORGED evict (rogue key claiming the admin) never lands; a self-leave by someone else never emits', async () => {
    const rosterAll = [{ webid: 'webid:admin', role: 'admin' }, { webid: 'webid:mel', role: 'member' }];
    const wire = [];
    const admin = await device('webid:admin', rosterAll, wire);
    const bob = await device('webid:bob', [...rosterAll, { webid: 'webid:bob', role: 'member' }], wire);
    const rogue = await AgentIdentity.generate(new VaultMemory());

    await bob.receiver(null, {
      subtype: MEMBERSHIP_BROADCAST, circleId: CIRCLE,
      event: signSpine(rogue, { kind: 'evict', circleId: CIRCLE, subject: 'webid:mel', payload: { authorRef: 'webid:admin' }, parent: null }),
    });
    expect(bob.eventLog.entries).toHaveLength(0);                    // unverifiable binding → refused

    // The emitter's self-leave guard: leaving someone ELSE never even signs.
    expect(await admin.emit({ kind: 'leave', circleId: CIRCLE, subject: 'webid:mel' })).toBeNull();
  });

  it('the OFFLINE third device catches up (pull-all, reversed) and folds the identical roster', async () => {
    const rosterAll = [{ webid: 'webid:admin', role: 'admin' }, { webid: 'webid:mel', role: 'member' }, { webid: 'webid:cato', role: 'member' }];
    const wire = [];
    const admin = await device('webid:admin', rosterAll, wire);
    const cato = await device('webid:cato', rosterAll, wire);
    const rows = [
      { id: 'red-mel', source: { groupId: CIRCLE, redeemedBy: 'webid:mel', confirmedBy: FOUNDER, redeemedAt: 1000 } },
      { id: 'red-cato', source: { groupId: CIRCLE, redeemedBy: 'webid:cato', confirmedBy: FOUNDER, redeemedAt: 1000 } },
    ];
    const memberMap = [{ webid: 'webid:admin', role: 'admin' }];

    await admin.emit({ kind: 'evict', circleId: CIRCLE, subject: 'webid:mel' });   // cato OFFLINE: sees nothing
    expect(cato.eventLog.entries).toHaveLength(0);

    const batches = [];
    const serve = makeGovernanceCatchUp({ rail: admin.rail, sendToPeer: (a, p) => batches.push(p), subtypes: MEMBERSHIP_CATCHUP_SUBTYPES });
    const pull  = makeGovernanceCatchUp({ rail: cato.rail, sendToPeer: () => {}, subtypes: MEMBERSHIP_CATCHUP_SUBTYPES });
    await serve.onRequest('peer:cato', { subtype: MEMBERSHIP_CATCHUP_SUBTYPES.request, circleId: CIRCLE });
    expect(batches).toHaveLength(1);
    const reversed = { ...batches[0], statements: [...batches[0].statements].reverse() };
    const res = await pull.onBatch('peer:admin', reversed);
    expect(res.landed).toBe(reversed.statements.length);

    const catoView = await rosterOf(cato, rows, memberMap);
    const adminView = await rosterOf(admin, rows, memberMap);
    expect(webids(catoView)).toEqual(webids(adminView));             // identical roster, mel out on both
    expect(webids(catoView)).toEqual(['webid:admin', 'webid:cato']);
  });

  it('THE CEREMONY BINDING: address-revoke binds ONLY by a root reveal against the row\'s commitment', async () => {
    const { membershipBindingVerifier } = await import('../../src/v2/membershipRail.js');
    const { Bootstrap, ceremonyCommitment, rootPubKeyB64Of, signCeremonyReveal } = await import('@onderling/core');
    const root = Bootstrap.create().bootstrap;
    const other = Bootstrap.create().bootstrap;
    const commitment = ceremonyCommitment(rootPubKeyB64Of(root.secret), 'g1');
    const row = {
      webid: 'webid:bea', circleAddress: 'dev-2-addr', ceremonyCommitment: commitment,
      circleAddresses: ['dev-2-addr', 'join-addr', 'dev-3-addr'],
    };
    const verify = membershipBindingVerifier(async () => ({ members: [row] }));
    const args = { ref: 'webid:bea', circleId: 'g1', kind: 'address-revoke', subject: 'dev-3-addr' };
    const reveal = signCeremonyReveal(root.secret, { circleId: 'g1', kind: 'address-revoke', subject: 'dev-3-addr', authorRef: 'webid:bea' });
    // the owner's root signed it → binds, whichever device key authored the statement
    expect(await verify({ ...args, author: 'brand-new-device-addr', payload: { reveal } })).toBe(true);
    // no reveal (a stolen device's own circle key, however well attested) → refused
    expect(await verify({ ...args, author: 'dev-2-addr', payload: {} })).toBe(false);
    // a reveal replayed onto ANOTHER subject → refused (the signature covers the subject)
    expect(await verify({ ...args, subject: 'dev-2-addr', author: 'dev-3-addr', payload: { reveal } })).toBe(false);
    // someone else's root → refused (hashes to a different commitment)
    const foreign = signCeremonyReveal(other.secret, { circleId: 'g1', kind: 'address-revoke', subject: 'dev-3-addr', authorRef: 'webid:bea' });
    expect(await verify({ ...args, author: 'dev-2-addr', payload: { reveal: foreign } })).toBe(false);
    // every other kind keeps the any-attested rule
    expect(await verify({ ref: 'webid:bea', circleId: 'g1', kind: 'evict', author: 'dev-3-addr' })).toBe(true);
    // a row WITHOUT a commitment cannot be revoked by statement at all — deny, never the interim rule
    const bare = membershipBindingVerifier(async () => ({
      members: [{ webid: 'webid:bea', circleAddress: 'dev-2-addr', circleAddresses: ['dev-2-addr'] }],
    }));
    expect(await bare({ ...args, author: 'dev-2-addr', payload: { reveal } })).toBe(false);
  });
});
