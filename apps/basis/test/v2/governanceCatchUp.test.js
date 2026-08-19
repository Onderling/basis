import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { bindCircleGovernance, makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makeGovernanceCatchUp, GOV_CATCHUP_REQUEST } from '../../src/v2/governanceCatchUp.js';
import { foldGovernance } from '../../src/v2/governanceLog.js';

// Step 5's acceptance: the THIRD device. A proposes, B votes — C is OFFLINE throughout. On reconnect C
// pulls the circle's governance statements (pull-all, the reliable tier), every one passes the rail's full
// ingest gate, and C folds the IDENTICAL state — under REVERSED delivery and SKEWED `at` timestamps (the
// fold is content-grouped, never clock-ordered). Redelivery is free (idempotent); forged statements in a
// batch drop while the rest land.

const CIRCLE = 'circle:cu';

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

/** A device: own log + rail + governance handle, sharing one roster (binding rows for everyone). */
async function mkDevice(ref, rosterAll, { policy }) {
  const cid = await AgentIdentity.generate(new VaultMemory());
  const eventLog = fakeEventLog();
  const row = rosterAll.find((m) => m.webid === ref);
  row.circleAddress = cid.pubKey;
  const callSkill = async (o, op, args) => {
    if (op === 'listGroupRoster') return { members: rosterAll.filter((m) => m.webid !== ref) };
    if (op === 'listMyCircles') return { circles: [{ groupId: CIRCLE }] };
    return { ok: true };
  };
  const circleIdentityFor = async () => cid;
  const rail = makeGovernanceRail({ eventLog, circleIdentityFor, myRef: ref, callSkill });
  const fanned = [];
  const gov = bindCircleGovernance({
    eventLog, callSkill, getPolicy: async () => policy, myRef: ref,
    genId: () => 'prop-cu-1', circleIdentityFor,
    broadcast: (channel, circleId, event) => fanned.push({ circleId, event }),
    setPolicy: async () => ({ ok: true }),
  });
  return { ref, cid, eventLog, rail, gov, fanned, callSkill };
}

async function foldOf(dev) {
  const ctx = await dev.gov.getContext(CIRCLE);
  return foldGovernance(ctx.events, { policy: ctx.policy, members: ctx.members, now: 100, disputed: ctx.disputed });
}
const foldKey = (fold) => JSON.stringify(fold.proposals.map((p) => ({
  id: p.proposalId, action: p.action, closed: p.closed,
  votes: [...p.votes].sort((a, b) => a.voter.localeCompare(b.voter) || (a.at ?? 0) - (b.at ?? 0)),
})));

describe('governance catch-up — the offline third device converges (pull-all, verified, idempotent)', () => {
  it('C misses everything, reconnects, pulls REVERSED + SKEWED statements from A, folds identically', async () => {
    const rosterAll = [
      { webid: 'webid:alice', role: 'admin' }, { webid: 'webid:bob', role: 'admin' }, { webid: 'webid:cato', role: 'member' },
    ];
    const policy = { admins: ['webid:alice', 'webid:bob'], governance: { removeMember: 'member-vote' } };
    const A = await mkDevice('webid:alice', rosterAll, { policy });
    const B = await mkDevice('webid:bob', rosterAll, { policy });
    const C = await mkDevice('webid:cato', rosterAll, { policy });

    // Alice proposes (skewed: at=50) and votes (at=10 — EARLIER than the propose; clock skew).
    await A.gov.propose({ circleId: CIRCLE, action: 'removeMember', subject: 'webid:mel', actor: { ref: 'webid:alice', role: 'admin' } });
    await A.gov.vote({ circleId: CIRCLE, proposalId: 'prop-cu-1', voter: 'webid:alice', choice: 'yes' });
    // The fan reaches B (online) — B ingests alice's statements, then votes himself; his vote fans to A.
    for (const f of A.fanned) await B.rail.ingest(f.circleId, f.event);
    await B.gov.vote({ circleId: CIRCLE, proposalId: 'prop-cu-1', voter: 'webid:bob', choice: 'no' });
    for (const f of B.fanned) await A.rail.ingest(f.circleId, f.event);
    // C was OFFLINE for all of it.
    expect(C.eventLog.entries).toHaveLength(0);

    // A and B agree already (the online pair).
    expect(foldKey(await foldOf(A))).toBe(foldKey(await foldOf(B)));

    // C reconnects → pulls from A. The wire REVERSES the batch (arrival order must not matter).
    const wire = [];
    const catchUpA = makeGovernanceCatchUp({ rail: A.rail, sendToPeer: (addr, payload) => wire.push({ addr, payload }) });
    const landedTotals = [];
    const catchUpC = makeGovernanceCatchUp({
      rail: C.rail, sendToPeer: () => {}, onChange: (cid) => landedTotals.push(cid),
    });
    await catchUpA.onRequest('peer:cato', { subtype: GOV_CATCHUP_REQUEST, circleId: CIRCLE });
    expect(wire).toHaveLength(1);
    const batch = { ...wire[0].payload, statements: [...wire[0].payload.statements].reverse() };
    const res = await catchUpC.onBatch('peer:alice', batch);
    expect(res.landed).toBe(batch.statements.length);
    expect(landedTotals).toContain(CIRCLE);

    // The third device folds the IDENTICAL state — reorder + skew notwithstanding.
    expect(foldKey(await foldOf(C))).toBe(foldKey(await foldOf(A)));
    const cFold = await foldOf(C);
    expect(cFold.proposals[0].votes).toHaveLength(3);               // alice's implicit propose-vote + her explicit + bob's — all on the offline device

    // Redelivery is free: the same batch again lands nothing new.
    const before = C.eventLog.entries.length;
    await catchUpC.onBatch('peer:alice', batch);
    expect(C.eventLog.entries.length).toBe(before);
  });

  it('a FORGED statement inside a batch drops at the rail gate; the genuine rest still land', async () => {
    const rosterAll = [
      { webid: 'webid:alice', role: 'admin' }, { webid: 'webid:cato', role: 'member' },
    ];
    const policy = { admins: ['webid:alice'], governance: { removeMember: 'member-vote' } };
    const A = await mkDevice('webid:alice', rosterAll, { policy });
    const C = await mkDevice('webid:cato', rosterAll, { policy });
    await A.gov.propose({ circleId: CIRCLE, action: 'removeMember', subject: 'webid:mel', actor: { ref: 'webid:alice', role: 'admin' } });

    const rogue = await AgentIdentity.generate(new VaultMemory());   // NOT on the roster
    const forged = signSpine(rogue, { kind: 'vote', circleId: CIRCLE, subject: 'prop-cu-1', payload: { voter: 'webid:alice', choice: 'yes', authorRef: 'webid:alice' }, parent: null });
    const genuine = A.rail.storedStatements(CIRCLE);
    const catchUpC = makeGovernanceCatchUp({ rail: C.rail, sendToPeer: () => {} });
    const res = await catchUpC.onBatch('peer:x', { subtype: 'circle-governance-catchup-batch', circleId: CIRCLE, statements: [forged, ...genuine] });
    expect(res.landed).toBe(genuine.length);                         // the forgery dropped, the rest landed
    expect(C.eventLog.entries.every((e) => e.payload?.body?.hash !== forged.body.hash)).toBe(true);
    const cFold = await foldOf(C);
    // propose() appends the proposer's own implicit yes — that ONE genuine vote folds; nothing fabricated does.
    expect(cFold.proposals[0].votes).toEqual([expect.objectContaining({ voter: 'webid:alice', choice: 'yes' })]);
  });

  it('requestAll asks every reachable member of every circle (the reconnect kick)', async () => {
    const sent = [];
    const rail = { storedStatements: () => [], ingest: async () => ({ ok: false }) };
    const cu = makeGovernanceCatchUp({ rail, sendToPeer: (addr, payload) => sent.push({ addr, subtype: payload.subtype }) });
    const callSkill = async (o, op) => {
      if (op === 'listMyCircles') return { circles: [{ groupId: 'c1' }, { groupId: 'c2' }] };
      if (op === 'listGroupRoster') return { members: [{ webid: 'w1', addr: 'addr:1' }, { webid: 'w2' /* unreachable */ }] };
      return {};
    };
    const { requested } = await cu.requestAll({ callSkill });
    expect(requested).toBe(2);                                       // one reachable member × two circles
    expect(sent.every((s) => s.subtype === GOV_CATCHUP_REQUEST)).toBe(true);
  });
});
