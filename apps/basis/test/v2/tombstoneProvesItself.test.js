/**
 * A COMPACTED STATEMENT STILL PROVES ITSELF, AND A LATE JOINER FOLDS THE SAME ROSTER (story S10; format v2).
 *
 * A device compacts a `member-props` statement the roster fold called dead: it keeps the signed HEADER and its
 * signature and drops the payload. Before format v2 a tombstone had no signature left, so a member who joined later
 * could not accept it, lacked that parent, gave later statements a lower causal depth and could fold a different
 * roster (lateJoinerFoldOrder.test.js). Now the tombstone is checked like any statement: the late joiner takes it
 * from a catch-up, keeps the causal edge, and folds what the others fold. A planted one is refused.
 *
 * Through the REAL membership rail and the REAL fold, with statements signed by real keys.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine, foldRoster } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { EventLog, makeSilentEntry } from '../../src/eventLog.js';
import { makeMembershipRail } from '../../src/v2/membershipRail.js';
import { MEMBERSHIP_LANE } from '../../src/v2/membershipManifest.js';

const CID = 'circle-tombstone-proves-itself';
const entry = (statement) => makeSilentEntry({ circleId: CID, kind: MEMBERSHIP_LANE, payload: statement, id: `${MEMBERSHIP_LANE}:${statement.body.hash}`, ts: Date.now() });

async function people() {
  const [founder, bram, alex] = await Promise.all([1, 2, 3].map(() => AgentIdentity.generate(new VaultMemory())));
  const s = (who, kind, subject, payload, o = {}) => signSpine(who, { kind, circleId: CID, subject, payload: { authorRef: who.pubKey, ...payload }, ...o });
  const joinBram = s(founder, 'join', bram.pubKey, { rulesAccepted: 'v1' });
  const joinAlex = s(founder, 'join', alex.pubKey, { rulesAccepted: 'v1' }, { parent: joinBram.body.hash });
  const promote = s(founder, 'role', alex.pubKey, { role: 'admin' }, { parent: joinAlex.body.hash });
  const name1 = s(bram, 'member-props', bram.pubKey, { displayName: 'Bram Een' }, { deps: [joinBram.body.hash] });
  const name2 = s(bram, 'member-props', bram.pubKey, { displayName: 'Bram Twee' }, { parent: name1.body.hash, deps: [joinBram.body.hash] });
  const evict = s(alex, 'evict', bram.pubKey, {}, { deps: [name2.body.hash] });
  return { founder, bram, alex, all: [joinBram, joinAlex, promote, name1, name2, evict], name1 };
}

function railOver(eventLog, { founder, bram, alex }) {
  return makeMembershipRail({
    eventLog,
    circleIdentityFor: async () => founder,
    ownCeremonyCommitmentFor: () => null,
    myRef: () => founder.pubKey,
    callSkill: async () => ({ members: [founder, bram, alex].map((p) => ({ webid: p.pubKey, circleAddress: p.pubKey })) }),
  });
}

const rosterOf = async (rail, founder) => {
  const { bodies } = await rail.readVerifiedBodies(CID);
  const f = foldRoster(bodies, { founders: [founder.pubKey] });
  return { members: [...f.members].sort(), admins: [...f.admins].sort(), bodies };
};

describe('a compacted statement proves itself (format v2)', () => {
  it('the device that compacts keeps a tombstone that still verifies, and its roster is unchanged', async () => {
    const p = await people();
    const log = new EventLog(); log.hydrate(p.all.map(entry));
    const rail = railOver(log, p);
    const before = await rosterOf(rail, p.founder);
    expect(rail.compact(CID, [p.name1.body.hash])).toBe(1);
    const tomb = log.query({}).find((e) => e.payload?.tombstone === true)?.payload;
    expect(tomb?.sig, 'the tombstone keeps its signature').toBeTruthy();
    expect(tomb?.body?.payload, 'and drops the payload, but its authorRef').toEqual({ authorRef: p.bram.pubKey });
    const after = await rosterOf(rail, p.founder);
    expect(after.bodies.some((b) => b.hash === p.name1.body.hash && b.tombstone === true)).toBe(true);
    expect({ members: after.members, admins: after.admins }).toEqual({ members: before.members, admins: before.admins });
  });

  it('a LATE JOINER takes the tombstone from a catch-up and folds the SAME roster as the devices that were there', async () => {
    const p = await people();
    const there = new EventLog(); there.hydrate(p.all.map(entry));
    const thereRail = railOver(there, p);
    thereRail.compact(CID, [p.name1.body.hash]);
    const served = thereRail.storedStatements(CID);   // what a catch-up would hand on, the tombstone among them
    expect(served.some((st) => st.tombstone === true && thereRail.checkSigned(CID, st)), 'the tombstone may be sent on').toBe(true);
    const late = new EventLog();
    const lateRail = railOver(late, p);
    for (const st of served) expect((await lateRail.ingest(CID, st)).ok, JSON.stringify(st.body?.kind)).toBe(true);
    const a = await rosterOf(thereRail, p.founder);
    const b = await rosterOf(lateRail, p.founder);
    expect({ members: b.members, admins: b.admins }).toEqual({ members: a.members, admins: a.admins });
    expect(b.members, 'alex evicted bram after being made admin, on the late joiner too').not.toContain(p.bram.pubKey);
  });

  it('a PLANTED tombstone is refused on ingest and on read: an unsigned one, or a real one with its header changed', async () => {
    const p = await people();
    const there = new EventLog(); there.hydrate(p.all.map(entry));
    const rail = railOver(there, p);
    rail.compact(CID, [p.name1.body.hash]);
    const real = rail.storedStatements(CID).find((st) => st.tombstone === true);
    const changed = { ...real, body: { ...real.body, authorRef: p.alex.pubKey } };
    const unsigned = { tombstone: true, body: { ...real.body, hash: '1'.repeat(64) } };
    const late = new EventLog();
    const lateRail = railOver(late, p);
    for (const planted of [changed, unsigned]) expect((await lateRail.ingest(CID, planted)).ok).toBe(false);
    // planted straight into a log (not through ingest): the read side refuses it too
    const log = new EventLog(); log.hydrate([...p.all.filter((s) => s !== p.name1).map(entry), makeSilentEntry({ circleId: CID, kind: MEMBERSHIP_LANE, payload: changed, id: `${MEMBERSHIP_LANE}:planted`, ts: Date.now() })]);
    const { bodies } = await railOver(log, p).readVerifiedBodies(CID);
    expect(bodies.some((b) => b.tombstone === true)).toBe(false);
  });
});
