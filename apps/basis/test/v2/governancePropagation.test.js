/**
 * Governance/report propagation (Wave C, tail A) — the one log replicates across devices.
 *
 * Two EventLogs stand in for two members' devices. Device A's binder fans each appended
 * governance/report event; device B's ingest receiver appends it to B's log (deduped by the
 * stable entry id). Then B's own binder folds the same open proposal — a vote raised on A is
 * seen on B. Locks: an event fanned from A lands in B; a re-delivery doesn't double-append;
 * B resolves the proposal identically.
 */
import { describe, it, expect, vi } from 'vitest';
import { bindCircleGovernance } from '../../src/v2/governanceAppWiring.js';
import { makeKringGovernancePeerHandler, makeKringReportPeerHandler } from '../../src/v2/kringLogReceiver.js';
import { EventLog } from '../../src/eventLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

// Full membership: admin0 (admin) + m0/m1/m2. listGroupRoster excludes the CALLER, so each
// device's mock returns everyone-but-itself; readCircleMembers adds the device back → all 4.
const FULL = [{ addr: 'admin0', role: 'admin' }, { addr: 'm0', role: 'member' }, { addr: 'm1', role: 'member' }, { addr: 'm2', role: 'member' }];
const rosterExcluding = (ref) => ({ members: FULL.filter((m) => m.addr !== ref) });
const callSkillFor = (ref) => vi.fn(async (o, op) => (op === 'listGroupRoster' ? rosterExcluding(ref) : { ok: true }));
const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

/** Wire device A's fan straight into device B's ingest receivers (the transport stand-in). */
function twoDevices() {
  const logA = new EventLog({ initial: [] });
  const logB = new EventLog({ initial: [] });
  const ingestGovB = makeKringGovernancePeerHandler({ eventLog: logB });
  const ingestRepB = makeKringReportPeerHandler({ eventLog: logB });
  const broadcast = (channel, circleId, event) => {
    const subtype = channel === 'governance' ? 'kring-governance-broadcast' : 'kring-report-broadcast';
    const handler = channel === 'governance' ? ingestGovB : ingestRepB;
    handler(null, { subtype, circleId, event, ts: Date.now() });   // deliver to B
  };
  let n = 0;
  const govA = bindCircleGovernance({ eventLog: logA, callSkill: callSkillFor('admin0'), getPolicy: async () => policy, myRef: 'admin0', genId: () => `p${(n += 1)}`, now: () => 1, broadcast });
  // device B reads its OWN log; no fan needed for the assertion side.
  const govB = bindCircleGovernance({ eventLog: logB, callSkill: callSkillFor('m0'), getPolicy: async () => policy, myRef: 'm0', genId: () => `q${(n += 1)}`, now: () => 1 });
  return { logA, logB, govA, govB };
}

describe('governance propagation (A → B)', () => {
  it('a member-vote opened on A is fanned to B and appears in B\'s view', async () => {
    const { logB, govA, govB } = twoDevices();
    const { proposalId } = await govA.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });

    // B's log received the propose + the proposer's auto-vote.
    const govEntries = logB.query({}).filter((e) => e.type === 'governance' && e.circleId === 'c1');
    expect(govEntries.length).toBe(2);
    // B folds the SAME open proposal.
    const v = await govB.view('c1');
    const row = v.open.find((r) => r.proposalId === proposalId);
    expect(row).toBeTruthy();
    expect(row.status).toBe(DECISION_STATUS.PENDING);
    expect(row.tally).toEqual({ yes: 1, no: 0, need: 3, of: 4 });   // admin0's yes, 4 members incl. B's admin0
  });

  it('a re-delivered event does not double-append (stable-id dedup)', async () => {
    const { logB } = twoDevices();
    const ingest = makeKringGovernancePeerHandler({ eventLog: logB });
    const chained = { kind: 'governance', event: 'vote', proposalId: 'p1', voter: 'm0', choice: 'yes', hash: 'abc', author: 'm0', parentHash: null };
    await ingest(null, { subtype: 'kring-governance-broadcast', circleId: 'c1', event: chained, ts: Date.now() });
    await ingest(null, { subtype: 'kring-governance-broadcast', circleId: 'c1', event: chained, ts: Date.now() });   // same event again
    expect(logB.query({}).filter((e) => e.type === 'governance').length).toBe(1);
  });

  it('votes cast on A propagate; B sees the tally cross the threshold', async () => {
    const { govA, govB } = twoDevices();
    const { proposalId } = await govA.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });
    await govA.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });   // 2/4
    await govA.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });   // 3/4 → majority
    const v = await govB.view('c1');
    // B sees it reached approval (its own device would enact if B were the admin).
    const row = [...v.open, ...v.closed].find((r) => r.proposalId === proposalId);
    expect(row.status).toBe(DECISION_STATUS.APPROVED);
  });

  it('a report fanned from A lands in B', async () => {
    const { logB, govA } = twoDevices();
    await govA.reports.file({ circleId: 'c1', targetType: 'member', targetRef: 'm2', reason: 'spam' });
    const repEntries = logB.query({}).filter((e) => e.type === 'report' && e.circleId === 'c1');
    expect(repEntries.length).toBe(1);
    expect(repEntries[0].payload).toMatchObject({ targetType: 'member', targetRef: 'm2', reason: 'spam' });
  });
});
