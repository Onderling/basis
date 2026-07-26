/**
 * Governance across THREE devices — stories 3.1 + 3.2 of `plans/NOTE-multi-device-user-stories.md`.
 *
 * `governancePropagation.test.js` proves A → B replication. Two devices can't express the two properties
 * that actually bite in the field, both of which need a third party:
 *   • 3.1 — a voter who was PARTITIONED during the vote converges to the SAME tally on reconnect, and their
 *     later vote is not double-counted against the copy that reached the others while they were away.
 *   • 3.2 — a NON-ADMIN casting the tipping vote must not enact: they show "awaiting an admin", the admin
 *     enacts, and the real-world side effect fires EXACTLY ONCE across all three devices (not per voter).
 *
 * Cast: Anna (admin0, admin) · Bram (m0, member) · Cato (m1, member — the partitioned / tipping one).
 */
import { describe, it, expect, vi } from 'vitest';
import { bindCircleGovernance } from '../../src/v2/governanceAppWiring.js';
import { makeKringGovernancePeerHandler } from '../../src/v2/kringLogReceiver.js';
import { EventLog } from '../../src/eventLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const FULL = [
  { addr: 'admin0', role: 'admin' },
  { addr: 'm0', role: 'member' },
  { addr: 'm1', role: 'member' },
  { addr: 'm2', role: 'member' },
];
const rosterExcluding = (ref) => ({ members: FULL.filter((m) => m.addr !== ref) });
const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });

/**
 * Three devices on one bus, each with its own log + ingest. A device may be PARTITIONED: events addressed
 * to it are held (as the relay's hold-forward would) and flushed on reconnect — offline is a first-class
 * state here, not an error path.
 */
function threeDevices() {
  const devices = {};
  const held = {};                                   // ref → [payload] while partitioned

  for (const ref of ['admin0', 'm0', 'm1']) {
    const log = new EventLog({ initial: [] });
    devices[ref] = { ref, log, online: true, enacted: [], ingest: makeKringGovernancePeerHandler({ eventLog: log }) };
    held[ref] = [];
  }

  /** Fan an event from `fromRef` to the OTHER two devices (holding for the partitioned). */
  const broadcastFrom = (fromRef) => (_channel, circleId, event) => {
    const payload = { subtype: 'kring-governance-broadcast', circleId, event, ts: Date.now() };
    for (const ref of Object.keys(devices)) {
      if (ref === fromRef) continue;
      if (devices[ref].online) devices[ref].ingest(null, payload);
      else held[ref].push(payload);
    }
  };

  let n = 0;
  for (const ref of Object.keys(devices)) {
    const d = devices[ref];
    d.gov = bindCircleGovernance({
      eventLog: d.log,
      callSkill: vi.fn(async (app, op, args) => {
        if (op === 'listGroupRoster') return rosterExcluding(ref);
        // Every non-roster op is a real-world side effect — record WHICH device performed it.
        d.enacted.push({ op, args });
        return { ok: true };
      }),
      getPolicy: async () => policy,
      myRef: ref,
      genId: () => `p${(n += 1)}`,
      now: () => 1,
      broadcast: broadcastFrom(ref),
    });
  }

  return {
    devices,
    partition: (ref) => { devices[ref].online = false; },
    reconnect: (ref) => {                            // flush everything held while away, in order
      devices[ref].online = true;
      const queue = held[ref].splice(0, held[ref].length);
      for (const p of queue) devices[ref].ingest(null, p);
    },
    /** Every enact side effect that fired anywhere, tagged with the device that fired it. */
    enactsEverywhere: () => Object.values(devices).flatMap((d) => d.enacted.map((e) => ({ by: d.ref, ...e }))),
  };
}

const openProposal = async (h, deadline = 100) =>
  (await h.devices.admin0.gov.propose({
    circleId: 'c1', action: 'removeMember', subject: 'm2', actor: { ref: 'admin0' }, deadline,
  })).proposalId;

describe('3.1 — a partitioned voter converges to the same tally, without double-counting', () => {
  it('Cato is offline through the vote, then reconnects to the SAME tally the others already had', async () => {
    const h = threeDevices();
    h.partition('m1');                                          // Cato goes offline BEFORE the proposal

    const proposalId = await openProposal(h);
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });

    const tallyOf = async (ref) => {
      const v = await h.devices[ref].gov.view('c1');
      return [...v.open, ...v.closed].find((r) => r.proposalId === proposalId)?.tally;
    };
    const annaTally = await tallyOf('admin0');
    expect(annaTally).toEqual({ yes: 2, no: 0, need: 3, of: 4 });   // Anna's auto-yes + Bram
    expect(await tallyOf('m0')).toEqual(annaTally);                  // Bram agrees
    expect(await tallyOf('m1')).toBeUndefined();                     // Cato saw nothing while away

    h.reconnect('m1');
    expect(await tallyOf('m1')).toEqual(annaTally);                  // converges exactly, no drift
  });

  it('a vote that reached the others while Cato was away is not double-counted on reconnect', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);

    // Bram votes while Cato is online (Cato receives it), then Cato partitions and the SAME event is
    // re-delivered on reconnect — the classic replay a hold-forward flush produces.
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });
    const before = await h.devices.m1.gov.view('c1');
    const beforeTally = [...before.open, ...before.closed].find((r) => r.proposalId === proposalId).tally;

    h.partition('m1');
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });   // duplicate
    h.reconnect('m1');

    const after = await h.devices.m1.gov.view('c1');
    const afterTally = [...after.open, ...after.closed].find((r) => r.proposalId === proposalId).tally;
    expect(afterTally.yes).toBe(beforeTally.yes);                    // one voter, one vote
  });
});

describe('3.2 — a non-admin tipping vote does not enact; the admin does, exactly once', () => {
  it('Cato (non-admin) casts the deciding vote: approved everywhere, but Cato does NOT enact', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });   // 2/4

    // The tipping vote is cast ON Cato's own device by Cato.
    await h.devices.m1.gov.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });       // 3/4 → approved

    const rowOn = async (ref) => {
      const v = await h.devices[ref].gov.view('c1');
      return [...v.open, ...v.closed].find((r) => r.proposalId === proposalId);
    };
    expect((await rowOn('m1')).status).toBe(DECISION_STATUS.APPROVED);
    expect((await rowOn('admin0')).status).toBe(DECISION_STATUS.APPROVED);   // Anna sees it too

    // The member device must not perform the removal itself — that is the admin's to enact.
    expect(h.devices.m1.enacted).toEqual([]);
    expect(h.devices.m0.enacted).toEqual([]);
  });

  // ✅ FIXED 2026-07-26 (Decision B: an explicit admin `settle()`, not enact-on-ingest). Enactment used to
  // run ONLY as a side effect of a local vote()/override(), so a tipping vote that merely FANNED here left
  // the decision approved-but-unenacted forever. `settle()` sweeps the open proposals and enacts the ones
  // this device may enact; on a member device it is a no-op by construction.
  it('the real-world removal fires EXACTLY ONCE across all three devices (on the admin, not per voter)', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });
    await h.devices.m1.gov.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });        // approved

    // Every device folds an APPROVED proposal; each also SETTLES. Only the admin may turn that into the op —
    // the member devices' settle() is a no-op, which is the property under test.
    for (const ref of ['admin0', 'm0', 'm1']) {
      await h.devices[ref].gov.view('c1');
      await h.devices[ref].gov.settle('c1');
    }

    const removals = h.enactsEverywhere().filter((e) => /remove/i.test(e.op));
    expect(removals.map((r) => r.by)).toEqual(['admin0']);          // exactly one, and on the ADMIN
  });
});
