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
import { describe, it, expect } from 'vitest';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';
import { threeDevices, openProposal } from './helpers/threeDeviceGovernance.js';

// The harness (three devices, hold-forward partitions, both fan channels, a mutable clock) lives in
// `helpers/threeDeviceGovernance.js` — shared with the 3.3/3.5/3.6 suite so both drive ONE substrate.

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

  // The chip that TELLS the voter what 3.2 guarantees. Both shells render `row.approved &&
  // row.awaitingEnactment` ("awaiting an admin" / "wacht op een beheerder"), but until 2026-07-26 the flag
  // lived only on `tally()`'s return value and was never set on a view row — so the chip was dead on web AND
  // mobile, and a member who cast the tipping vote saw "Approved" with no hint that anything was pending.
  it('the voter is TOLD they are waiting for an admin — the chip has a value to read', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });
    await h.devices.m1.gov.vote({ circleId: 'c1', proposalId, voter: 'm1', choice: 'yes' });   // approved

    const cato = await h.rowOn('m1', proposalId);
    expect(cato.approved).toBe(true);
    expect(cato.awaitingEnactment).toBe(true);          // …so the chip renders

    // Once the admin actually enacts, the proposal closes and the chip must go away — otherwise it would
    // sit there forever claiming a wait that already ended.
    await h.devices.admin0.gov.settle('c1');
    const annaAfter = await h.rowOn('admin0', proposalId);
    expect(annaAfter.closed).toBe(true);
    expect(annaAfter.awaitingEnactment).toBe(false);
  });
});
