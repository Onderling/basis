/**
 * Governance/report propagation (Wave C, tail A) — the one log replicates across devices.
 *
 * Devices stand in for members; device A's binder fans each appended SIGNED statement; every other device's
 * ingest receiver runs the full rail gate (verify + declared kind + key↔ref binding) before appending to its
 * own log (deduped by the stable id). Since the governance cutover a vote can only be cast on the VOTER'S OWN
 * device — signing as someone else is exactly what the rail refuses — so this suite drives a small mesh.
 * Locks: a statement fanned from A lands on B; a re-delivery doesn't double-append; B resolves identically;
 * an unsigned bare event is refused.
 */
import { describe, it, expect, vi } from 'vitest';
import { AgentIdentity, signSpine } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { bindCircleGovernance, makeGovernanceRail } from '../../src/v2/governanceAppWiring.js';
import { makeCircleGovernancePeerHandler, makeCircleReportPeerHandler } from '../../src/v2/circleLogReceiver.js';
import { EventLog } from '../../src/eventLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

/** A mesh of member devices: per-device signing identity, log, rail-verified receiver, and binder — every
 *  fan delivers to every OTHER device through the full ingest gate. m2 (the usual subject) has no device. */
async function mesh(refs = ['admin0', 'm0', 'm1']) {
  const cids = {};
  for (const ref of refs) cids[ref] = await AgentIdentity.generate(new VaultMemory());
  const FULL = [
    { addr: 'admin0', role: 'admin' }, { addr: 'm0', role: 'member' },
    { addr: 'm1', role: 'member' }, { addr: 'm2', role: 'member' },
  ].map((m) => (cids[m.addr] ? { ...m, circleAddress: cids[m.addr].pubKey } : m));
  // The two roster ops answer DIFFERENTLY, and modelling them the same way is what hid F-020:
  //   listGroupRoster  → flat routing rows, EXCLUDING the caller
  //   listGroupMembers → the derived roster: `webid` + circleAddress, INCLUDING the caller
  const rosterExcluding = (ref) => ({ members: FULL.filter((m) => m.addr !== ref) });
  const membersIncluding = () => ({ members: FULL.map((m) => ({ ...m, webid: m.addr })) });

  const devices = {};
  const fanTo = (fromRef, circleId, event) => {
    for (const ref of refs) {
      if (ref === fromRef) continue;
      devices[ref].ingest(null, { subtype: 'circle-governance-broadcast', circleId, event, ts: Date.now() });
    }
  };
  let n = 0;
  for (const ref of refs) {
    const log = new EventLog({ initial: [] });
    const callSkill = vi.fn(async (o, op) => (
      op === 'listGroupMembers' ? membersIncluding()
        : op === 'listGroupRoster' ? rosterExcluding(ref)
          : { ok: true }));
    const rail = makeGovernanceRail({ eventLog: log, circleIdentityFor: async () => cids[ref], myRef: ref, callSkill });
    devices[ref] = { ref, log, rail, callSkill };
    devices[ref].ingest = makeCircleGovernancePeerHandler({ eventLog: log, rail });
    devices[ref].ingestReport = makeCircleReportPeerHandler({ eventLog: log });
    devices[ref].gov = bindCircleGovernance({
      eventLog: log, callSkill, getPolicy: async () => policy, myRef: ref,
      genId: () => `p${(n += 1)}`, now: () => 1,
      circleIdentityFor: async () => cids[ref],
      broadcast: (channel, circleId, event, opts) => {
        if (channel === 'report') {
          const allow = Array.isArray(opts?.to) ? new Set(opts.to) : null;
          for (const r of refs) {
            if (r === ref || (allow && !allow.has(r))) continue;
            devices[r].ingestReport(null, { subtype: 'circle-report-broadcast', circleId, event, ts: Date.now() });
          }
          return;
        }
        fanTo(ref, circleId, event);
      },
    });
  }
  return { devices, cids };
}

describe('governance propagation (signed statements across the mesh)', () => {
  it('a member-vote opened on A is fanned to B — verified on ingest — and appears in B\'s view', async () => {
    const { devices } = await mesh();
    const { proposalId } = await devices.admin0.gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });

    // B's log received the propose + the proposer's auto-vote — as verified SIGNED statements.
    const govEntries = devices.m0.log.query({}).filter((e) => e.type === 'governance' && e.circleId === 'c1');
    expect(govEntries.length).toBe(2);
    for (const e of govEntries) expect(e.payload.sig).toBeTruthy();
    // B folds the SAME open proposal.
    const v = await devices.m0.gov.view('c1');
    const row = v.open.find((r) => r.proposalId === proposalId);
    expect(row).toBeTruthy();
    expect(row.status).toBe(DECISION_STATUS.PENDING);
    expect(row.tally).toEqual({ yes: 1, no: 0, need: 3, of: 4 });
  });

  it('a re-delivered statement does not double-append (stable-id dedup)', async () => {
    const { devices, cids } = await mesh();
    const stmt = signSpine(cids.m0, { kind: 'vote', circleId: 'c1', subject: 'p1', payload: { voter: 'm0', choice: 'yes', authorRef: 'm0' }, parent: null });
    await devices.admin0.ingest(null, { subtype: 'circle-governance-broadcast', circleId: 'c1', event: stmt, ts: Date.now() });
    await devices.admin0.ingest(null, { subtype: 'circle-governance-broadcast', circleId: 'c1', event: stmt, ts: Date.now() });
    expect(devices.admin0.log.query({}).filter((e) => e.type === 'governance').length).toBe(1);
  });

  it('an UNSIGNED bare event is refused at the rail receiver — the legacy path is gone', async () => {
    const { devices } = await mesh();
    const bare = { kind: 'governance', event: 'vote', proposalId: 'p1', voter: 'm0', choice: 'yes', hash: 'abc', author: 'm0', parentHash: null };
    await devices.admin0.ingest(null, { subtype: 'circle-governance-broadcast', circleId: 'c1', event: bare, ts: Date.now() });
    expect(devices.admin0.log.query({}).filter((e) => e.type === 'governance')).toHaveLength(0);
  });

  it('votes cast on the VOTERS\' OWN devices propagate; A sees the tally cross the threshold', async () => {
    const { devices } = await mesh();
    const { proposalId } = await devices.admin0.gov.propose({ circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline: 100 });
    await devices.m0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });   // 2/4
    await devices.m1.gov.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });   // 3/4 → majority
    const v = await devices.m0.gov.view('c1');
    const row = [...v.open, ...v.closed].find((r) => r.proposalId === proposalId);
    expect(row.status).toBe(DECISION_STATUS.APPROVED);
  });

  it('in-app nudge: a PROPOSE notifies once; a vote does not; a re-delivery does not re-notify', async () => {
    const { devices, cids } = await mesh();
    const notify = vi.fn();
    const ingest = makeCircleGovernancePeerHandler({ eventLog: devices.admin0.log, rail: devices.admin0.rail, notify });
    const propose = signSpine(cids.m0, { kind: 'propose', circleId: 'c1', subject: 'p9', payload: { action: 'removeMember', by: 'm0', authorRef: 'm0', at: 1 }, parent: null });
    const vote = signSpine(cids.m0, { kind: 'vote', circleId: 'c1', subject: 'p9', payload: { voter: 'm0', choice: 'yes', authorRef: 'm0', at: 2 }, parent: propose.body.hash });
    await ingest(null, { subtype: 'circle-governance-broadcast', circleId: 'c1', event: propose, ts: Date.now() });
    await ingest(null, { subtype: 'circle-governance-broadcast', circleId: 'c1', event: propose, ts: Date.now() }); // re-delivery
    await ingest(null, { subtype: 'circle-governance-broadcast', circleId: 'c1', event: vote, ts: Date.now() });
    expect(notify).toHaveBeenCalledTimes(1);                 // only the first propose
    expect(notify).toHaveBeenCalledWith('c1', expect.objectContaining({ event: 'propose', proposalId: 'p9', action: 'removeMember' }));
  });

  it('a report filed by a member lands on the ADMIN\'s device (the narrowed report fan)', async () => {
    const { devices } = await mesh();
    await devices.m0.gov.reports.file({ circleId: 'c1', targetType: 'member', targetRef: 'm2', reason: 'spam' });
    const repEntries = devices.admin0.log.query({}).filter((e) => e.type === 'report' && e.circleId === 'c1');
    expect(repEntries.length).toBe(1);
    expect(repEntries[0].payload).toMatchObject({ targetType: 'member', targetRef: 'm2', reason: 'spam' });
    // …and the non-admin bystander does NOT hold it (story 3.6: the fan narrows to admins ∪ reporter).
    expect(devices.m1.log.query({}).filter((e) => e.type === 'report')).toHaveLength(0);
  });
});
