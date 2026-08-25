/**
 * The caretaker notice — what a person is told when a circle becomes theirs, and when the rest of the
 * circle is told who is running it now.
 *
 * These tests drive the decision against REAL folded rosters (signed statements → foldRoster), not
 * against hand-built shapes, so the notice cannot drift away from what the fold actually derives.
 */
import { describe, it, expect } from 'vitest';
import { foldRoster, signSpine, AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { caretakerNotice, caretakerAcknowledgement, currentCaretaker, CARETAKER_NOTICE_KEYS } from '../../src/v2/caretakerNotice.js';

const CIRCLE = 'c';
const body = (id, kind, subject, { payload, parent = null, deps = [] } = {}) =>
  signSpine(id, { kind, circleId: CIRCLE, subject: subject.pubKey ?? subject, payload, parent, deps }).body;

/**
 * The roster rows the projection builds from a fold — `adminVia` and `adminViaAcknowledged` exactly as
 * `deriveRoster` stamps them. Written here rather than mocked, so a change to that contract shows up
 * as a failure in this file too.
 */
function rowsFrom(folded) {
  const admins = new Set(folded.admins);
  return folded.members.map((ref) => {
    const row = { webid: ref, role: admins.has(ref) ? 'admin' : 'member' };
    const via = folded.adminProvenance?.[ref];
    if (via) {
      row.adminVia = via;
      if (via.startsWith('caretaker:')
        && folded.caretakerAcknowledged?.[ref] === via.slice('caretaker:'.length)) {
        row.adminViaAcknowledged = true;
      }
    }
    return row;
  });
}

async function ids(n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await AgentIdentity.generate(new VaultMemory()));
  return out;
}

/** A circle whose only admin has left: founder + two members, founder leaves. */
async function circleWithCaretaker() {
  const [founder, bob, cato] = await ids();
  const joinB = body(bob, 'join', bob);
  const joinM = body(cato, 'join', cato);
  const leave = body(founder, 'leave', founder, { deps: [joinB.hash, joinM.hash] });
  const stmts = [joinB, joinM, leave];
  const folded = foldRoster(stmts, { founders: [founder.pubKey] });
  const caretakerRef = folded.admins[0];
  const caretaker = [bob, cato].find((p) => p.pubKey === caretakerRef);
  const other = [bob, cato].find((p) => p.pubKey !== caretakerRef);
  // Each person's own first statement, so a SECOND statement from them can be chained onto it. Two
  // statements from one author sharing a parent is a fork, and the fold discounts an equivocator
  // entirely — which is correct, and quietly turns a sloppy fixture into a test that proves nothing.
  const joinOf = { [bob.pubKey]: joinB, [cato.pubKey]: joinM };
  return { founder, bob, cato, stmts, folded, caretakerRef, caretaker, other, leave, joinOf };
}

describe('caretakerNotice — the appointment nobody performed, said out loud', () => {
  it('tells the person the circle became theirs', async () => {
    const { folded, caretakerRef, leave } = await circleWithCaretaker();
    const notice = caretakerNotice({ members: rowsFrom(folded), myRef: caretakerRef });

    expect(notice).toMatchObject({
      key: CARETAKER_NOTICE_KEYS.mine,
      acknowledge: true,
      caretaker: caretakerRef,
      seed: leave.hash,
    });
  });

  it('says nothing to everyone else — they read it off the member list instead', async () => {
    const { folded, caretakerRef, other } = await circleWithCaretaker();
    // An unprompted line on every device would be noise, and would need device-local memory of what it
    // had already said. The roster row carries the same fact where someone would go looking for it.
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: other.pubKey })).toBeNull();
    const row = rowsFrom(folded).find((r) => r.webid === caretakerRef);
    expect(row.adminVia).toMatch(/^caretaker:/);
  });

  it('stops telling the caretaker once they have SIGNED for it — the log is the memory', async () => {
    const { stmts, caretaker, caretakerRef, leave, joinOf, founder } = await circleWithCaretaker();

    // Sign the acknowledgement this module itself specifies, and fold it with everything else. The
    // point of the round-trip: the payload shape here and the fold's admission rule are one contract.
    const ack = caretakerAcknowledgement({ circleId: CIRCLE, myRef: caretakerRef, seed: leave.hash });
    const signed = body(caretaker, ack.kind, ack.subject, {
      payload: ack.payload, parent: joinOf[caretakerRef].hash, deps: [leave.hash],
    });
    const folded = foldRoster([...stmts, signed], { founders: [founder.pubKey] });

    // The signature is recorded…
    expect(folded.caretakerAcknowledged[caretakerRef]).toBe(leave.hash);
    // …it did not re-title them as an ordinary promotion…
    expect(folded.adminProvenance[caretakerRef]).toBe(`caretaker:${leave.hash}`);
    // …and the notice stops, with no device-local bookkeeping involved.
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: caretakerRef })).toBeNull();
  });

  it('a signature naming the WRONG appointment records nothing — the derivation stays authoritative', async () => {
    const { stmts, caretaker, caretakerRef, other, leave, joinOf, founder } = await circleWithCaretaker();
    const founderRef = founder.pubKey;

    // The caretaker signs for a seed the fold never derived.
    const wrong = body(caretaker, 'role', caretakerRef, {
      payload: { role: 'admin', caretakerFor: 'a-seed-nobody-derived' },
      parent: joinOf[caretakerRef].hash, deps: [leave.hash],
    });
    const folded = foldRoster([...stmts, wrong], { founders: [founderRef] });
    expect(folded.caretakerAcknowledged[caretakerRef]).toBeUndefined();
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: caretakerRef })).not.toBeNull();   // still owed the telling

    // And an ordinary member cannot sign themselves into the role at all.
    const selfClaim = body(other, 'role', other.pubKey, {
      payload: { role: 'admin', caretakerFor: leave.hash },
      parent: joinOf[other.pubKey].hash, deps: [leave.hash],
    });
    const folded2 = foldRoster([...stmts, selfClaim], { founders: [founderRef] });
    expect(folded2.admins).toEqual([caretakerRef]);
    expect(folded2.caretakerAcknowledged[other.pubKey]).toBeUndefined();
  });

  it('says nothing at all when the circle has an ordinary admin', async () => {
    const [founder, bob] = await ids(2);
    const join = body(bob, 'join', bob);
    const folded = foldRoster([join], { founders: [founder.pubKey] });

    expect(currentCaretaker(rowsFrom(folded))).toBeNull();
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: founder.pubKey })).toBeNull();
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: bob.pubKey })).toBeNull();
  });

  it('says nothing about a PROMOTED admin — a decision someone took is not this', async () => {
    const [founder, bob] = await ids(2);
    const join    = body(bob, 'join', bob);
    const promote = body(founder, 'role', bob, { payload: { role: 'admin' }, deps: [join.hash] });
    const folded  = foldRoster([join, promote], { founders: [founder.pubKey] });

    expect(caretakerNotice({ members: rowsFrom(folded), myRef: bob.pubKey })).toBeNull();
  });

  it('a NEW departure is a new appointment, and gets said again', async () => {
    const { stmts, folded, caretaker, caretakerRef, other, founder, leave, joinOf } = await circleWithCaretaker();
    expect(caretakerNotice({ members: rowsFrom(folded), myRef: caretakerRef }).seed).toBe(leave.hash);

    // The caretaker leaves too. The last remaining member is appointed in their turn.
    const secondLeave = body(caretaker, 'leave', caretakerRef, {
      parent: joinOf[caretakerRef].hash, deps: [leave.hash],
    });
    const later = foldRoster([...stmts, secondLeave], { founders: [founder.pubKey] });
    expect(later.admins).toEqual([other.pubKey]);

    // Having announced the FIRST appointment does not silence the second: a different departure is a
    // different fact, and the person now holding the circle is a different person.
    const second = caretakerNotice({ members: rowsFrom(later), myRef: other.pubKey });
    expect(second).toMatchObject({ key: CARETAKER_NOTICE_KEYS.mine, acknowledge: true });
    expect(second.seed).toBe(secondLeave.hash);
  });
});
