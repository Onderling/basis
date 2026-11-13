/**
 * A PLANTED TOMBSTONE DOES NOT CHANGE WHO IS IN MY CIRCLE.
 *
 * A tombstone is a statement the roster fold itself called dead (a superseded `member-props`), compacted to its chain
 * fields on this device. It carries no signature any more, so the read side cannot check it, and it must therefore
 * carry nothing the fold can act on. Before this fix the read side handed the fold ANY stored entry marked
 * `tombstone: true`, of any declared kind and with whatever payload it held: one unsigned entry in this device's log
 * could make a stranger admin, or put words in a member's mouth.
 *
 * Through the REAL membership rail and the REAL fold (no stubs of either), with honest statements signed by real keys.
 * Known remainder, not closed here: a planted tombstone off a member's parent still adds a depth edge (a fake fork
 * shape); that closes with the statement format where a tombstone keeps its own signature.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine, foldRoster } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog, makeSilentEntry } from '../../src/eventLog.js';
import { makeMembershipRail } from '../../src/v2/membershipRail.js';
import { makeCircleEntryRail } from '../../src/v2/circleEntryRail.js';
import { MEMBERSHIP_LANE } from '../../src/v2/membershipManifest.js';

const CID = 'circle-forged-tombstone';

async function setup() {
  const founder = await AgentIdentity.generate(new VaultMemory());
  const member = await AgentIdentity.generate(new VaultMemory());
  const join = signSpine(founder, { kind: 'join', circleId: CID, subject: member.pubKey, payload: { authorRef: founder.pubKey, rulesAccepted: 'v1' } });
  const props = signSpine(member, { kind: 'member-props', circleId: CID, subject: member.pubKey, payload: { authorRef: member.pubKey, displayName: 'One' }, deps: [join.body.hash] });
  return { founder, member, join, props };
}

const entry = (statement, id) => makeSilentEntry({ circleId: CID, kind: MEMBERSHIP_LANE, payload: statement, id: `${MEMBERSHIP_LANE}:${id}`, ts: Date.now() });

async function fold({ founder, member }, entries) {
  const eventLog = new EventLog();
  eventLog.hydrate(entries);
  const rail = makeMembershipRail({
    eventLog,
    circleIdentityFor: async () => founder,
    ownCeremonyCommitmentFor: () => null,
    myRef: () => founder.pubKey,
    callSkill: async () => ({ members: [founder, member].map((p) => ({ webid: p.pubKey, circleAddress: p.pubKey })) }),
  });
  const { bodies } = await rail.readVerifiedBodies(CID);
  return { bodies, folded: foldRoster(bodies, { founders: [founder.pubKey] }), rail, eventLog };
}

describe('a planted tombstone does not change who is in my circle', () => {
  it('the honest log folds to the founder and the member, the founder admin', async () => {
    const s = await setup();
    const { folded } = await fold(s, [entry(s.join, s.join.body.hash), entry(s.props, s.props.body.hash)]);
    expect(folded.members).toEqual([s.founder.pubKey, s.member.pubKey].sort());
    expect(folded.admins).toEqual([s.founder.pubKey]);
  });

  it('an unsigned "role" tombstone does not make a stranger admin (only member-props can ever be a tombstone)', async () => {
    const s = await setup();
    const forged = { tombstone: true, body: { v: s.join.body.v, kind: 'role', circleId: CID, subject: 'MALLORY', author: 'no-key-at-all', parentHash: null, deps: [], hash: '0'.repeat(64), payload: { authorRef: s.founder.pubKey, role: 'admin' } } };
    const { folded, bodies } = await fold(s, [entry(s.join, s.join.body.hash), entry(s.props, s.props.body.hash), entry(forged, forged.body.hash)]);
    expect(bodies.some((b) => b.subject === 'MALLORY')).toBe(false);
    expect(folded.admins).toEqual([s.founder.pubKey]);
    expect(folded.members).not.toContain('MALLORY');
  });

  it('a planted member-props tombstone (no signature over its header) is refused outright (format v2)', async () => {
    const s = await setup();
    const forged = { tombstone: true, body: { v: s.join.body.v, kind: 'member-props', circleId: CID, subject: s.member.pubKey, author: s.member.pubKey, parentHash: s.props.body.hash, deps: [], hash: '1'.repeat(64), payload: { authorRef: s.member.pubKey, displayName: 'Mallory was here', role: 'admin' } } };
    const { bodies, folded } = await fold(s, [entry(s.join, s.join.body.hash), entry(s.props, s.props.body.hash), entry(forged, forged.body.hash)]);
    // format v2: a tombstone keeps its signed header, so one nobody signed is not taken at all (before v2 it was taken,
    // its payload forced to the authorRef alone, and the fake depth edge stayed)
    expect(bodies.find((b) => b.hash === forged.body.hash)).toBeUndefined();
    expect(folded.admins).toEqual([s.founder.pubKey]);
    expect(JSON.stringify(folded.props ?? {})).not.toContain('Mallory was here');
  });

  it('a real compaction still reads back: the superseded props become a tombstone and the roster is unchanged', async () => {
    const s = await setup();
    const newer = signSpine(s.member, { kind: 'member-props', circleId: CID, subject: s.member.pubKey, payload: { authorRef: s.member.pubKey, displayName: 'Two' }, parent: s.props.body.hash, deps: [s.join.body.hash] });
    const all = [entry(s.join, s.join.body.hash), entry(s.props, s.props.body.hash), entry(newer, newer.body.hash)];
    const before = await fold(s, all);
    expect(before.folded.superseded).toContain(s.props.body.hash);
    expect(before.rail.compact(CID, before.folded.superseded)).toBeGreaterThan(0);
    const { bodies } = await before.rail.readVerifiedBodies(CID);
    const after = foldRoster(bodies, { founders: [s.founder.pubKey] });
    expect(bodies.find((b) => b.hash === s.props.body.hash)?.tombstone).toBe(true);
    expect(after.members).toEqual(before.folded.members);
    expect(after.admins).toEqual(before.folded.admins);
  });
});

describe('a lane that never compacts takes no tombstone at all', () => {
  it('a governance lane hands no planted tombstone to its fold', async () => {
    const me = await AgentIdentity.generate(new VaultMemory());
    const eventLog = new EventLog();
    const forged = { tombstone: true, body: { v: 'x', kind: 'resolve', circleId: CID, subject: 'p1', author: 'nobody', parentHash: null, deps: [], hash: '2'.repeat(64), payload: { authorRef: me.pubKey, outcome: 'passed' } } };
    eventLog.hydrate([makeSilentEntry({ circleId: CID, kind: 'governance', payload: forged, id: `governance:${forged.body.hash}`, ts: Date.now() })]);
    const rail = makeCircleEntryRail({ eventLog, signerFor: async () => ({ identity: me, ref: me.pubKey }), entryKind: 'governance', declaredKinds: ['propose', 'vote', 'resolve'] });
    const read = await (rail.readVerifiedBodies ?? rail.read)(CID);
    const bodies = Array.isArray(read) ? read : (read?.bodies ?? []);
    expect(bodies.some((b) => b?.hash === forged.body.hash)).toBe(false);
  });
});
