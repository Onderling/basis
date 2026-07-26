/**
 * Governance across THREE devices, the ADVERSARIAL half — stories 3.3 · 3.5 · 3.6 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * 3.1/3.2 (`governanceThreeDevice.test.js`) cover the cooperative failures: partition, replay, double-enact.
 * These three are the ones where a participant is either HOSTILE or PRIVILEGED, and they are the stories
 * with no coverage at all:
 *   • 3.5 Equivocation (L3) — Anna signs two CONFLICTING events from the same chain parent and shows one to
 *     Bram and the other to Cato. On heal, a fork-proof must be minted, Anna must be disputed on BOTH
 *     devices, and her votes discounted IDENTICALLY. A dispute that lands on one replica and not the other
 *     is worse than no dispute at all: the two devices then disagree about who is trusted.
 *   • 3.3 Deadline override — the admin escape hatch. Its whole risk is a role-gated UI leak: if a member's
 *     device offers "Decide now", the escape hatch has become a bypass.
 *   • 3.6 Report → act — a report names a reporter and carries free text about a target. Who holds that
 *     payload is a privacy question, not a rendering question.
 *
 * Cast: Anna (admin0, admin) · Bram (m0) · Cato (m1) · Dirk (m2, the usual subject — never a device).
 */
import { describe, it, expect } from 'vitest';
import { chainEvent, authorHead, detectForks, verifyForkProof, foldDisputes } from '../../src/v2/governanceChain.js';
import { voteEvent, GOVERNANCE_KIND } from '../../src/v2/governanceLog.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { threeDevices, openProposal } from './helpers/threeDeviceGovernance.js';

/** Read the governance event payloads out of a device's log — the same view the fold gets. */
const eventsOn = (d) => d.log.query({}).filter((e) => e.type === GOVERNANCE_KIND && e.payload).map((e) => e.payload);

/** Hand-deliver a crafted governance event to ONE device, bypassing the fan. This is what a hostile client
 *  does: it does not broadcast honestly, it shows different things to different peers. */
const showTo = (d, circleId, event) =>
  d.ingestGovernance(null, { subtype: 'kring-governance-broadcast', circleId, event, ts: Date.now() });

/**
 * Anna equivocates: TWO votes on the same proposal, both chained to the SAME parent, so neither is a
 * legitimate successor of the other. Modelled by building the events directly — which is precisely the
 * capability a malicious client has (the honest wiring would chain the second to the first).
 */
function forgeConflictingVotes(h, proposalId) {
  const parentHash = authorHead(eventsOn(h.devices.admin0), 'admin0');
  const yes = chainEvent(voteEvent({ proposalId, voter: 'admin0', choice: 'yes' }), { author: 'admin0', parentHash });
  const no = chainEvent(voteEvent({ proposalId, voter: 'admin0', choice: 'no' }), { author: 'admin0', parentHash });
  return { yes, no, parentHash };
}

describe('3.5 — equivocation is detected, and the dispute is IDENTICAL on every replica', () => {
  it('two conflicting events from one parent are a detectable fork, with a verifiable proof', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    const { yes, no, parentHash } = forgeConflictingVotes(h, proposalId);

    // Sanity: they really are a fork and not just two different events — same author, same parent,
    // different hash. Without this the rest of the suite could pass on a malformed pair.
    expect(yes.author).toBe(no.author);
    expect(yes.parentHash).toBe(no.parentHash);
    expect(yes.parentHash).toBe(parentHash);
    expect(yes.hash).not.toBe(no.hash);

    const proofs = detectForks([...eventsOn(h.devices.admin0), yes, no]);
    expect(proofs).toHaveLength(1);
    expect(proofs[0].author).toBe('admin0');
    expect(verifyForkProof(proofs[0])).toBe(true);
  });

  it('Bram is shown YES and Cato NO; when the partition heals BOTH mark Anna disputed', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    const { yes, no } = forgeConflictingVotes(h, proposalId);

    // The partition: each victim sees only ONE side of Anna's fork, so neither can detect it yet.
    showTo(h.devices.m0, 'c1', yes);
    showTo(h.devices.m1, 'c1', no);
    expect((await h.devices.m0.gov.view('c1')).hasDisputed).toBe(false);
    expect((await h.devices.m1.gov.view('c1')).hasDisputed).toBe(false);

    // Heal: each device now also receives the side it was denied.
    showTo(h.devices.m0, 'c1', no);
    showTo(h.devices.m1, 'c1', yes);

    const bram = await h.devices.m0.gov.view('c1');
    const cato = await h.devices.m1.gov.view('c1');
    expect(bram.hasDisputed).toBe(true);
    expect(cato.hasDisputed).toBe(true);
    // IDENTICALLY — the property the story names. Same set, not merely both non-empty.
    expect(bram.disputed.map((x) => x.ref)).toEqual(['admin0']);
    expect(cato.disputed.map((x) => x.ref)).toEqual(bram.disputed.map((x) => x.ref));
  });

  it('the dispute is ORDER-INDEPENDENT — whichever side arrives first, the verdict is the same', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    const { yes, no } = forgeConflictingVotes(h, proposalId);

    showTo(h.devices.m0, 'c1', yes);        // Bram: yes then no
    showTo(h.devices.m0, 'c1', no);
    showTo(h.devices.m1, 'c1', no);         // Cato: no then yes — the reverse order
    showTo(h.devices.m1, 'c1', yes);

    const bram = await h.devices.m0.gov.view('c1');
    const cato = await h.devices.m1.gov.view('c1');
    expect(cato.disputed).toEqual(bram.disputed);
  });

  it('a disputed member\'s vote is DISCOUNTED — an equivocator cannot sway the tally', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);      // Anna's propose carries her own auto-yes: 1/4
    const before = await h.tallyOf('m0', proposalId);
    expect(before.yes).toBe(1);                    // non-vacuous: there IS a vote to lose

    const { yes, no } = forgeConflictingVotes(h, proposalId);
    showTo(h.devices.m0, 'c1', yes);
    showTo(h.devices.m0, 'c1', no);

    const after = await h.tallyOf('m0', proposalId);
    expect(after.yes).toBe(0);                     // her auto-yes is gone with her
    // The DENOMINATOR is unchanged: a disputed member becomes a permanent non-voter rather than being
    // removed from the roster. Pinned deliberately — it means a dispute RAISES the bar for everyone else
    // (still `need 3 of 4`), which is the safe direction but worth knowing before tuning quorum.
    expect(after.of).toBe(before.of);
    expect(after.need).toBe(before.need);
  });

  it('a dispute does not contaminate an HONEST member — only the equivocator is discounted', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    await h.devices.admin0.gov.vote({ circleId: 'c1', proposalId, voter: 'm0', choice: 'yes' });

    const { yes, no } = forgeConflictingVotes(h, proposalId);
    showTo(h.devices.m1, 'c1', yes);
    showTo(h.devices.m1, 'c1', no);

    const v = await h.devices.m1.gov.view('c1');
    expect(v.disputed.map((x) => x.ref)).toEqual(['admin0']);   // Bram is NOT swept up
    const tally = await h.tallyOf('m1', proposalId);
    expect(tally.yes).toBe(1);                                   // Bram's honest yes survives
  });

  it('foldDisputes over a device\'s OWN log agrees with the view — no second opinion', async () => {
    const h = threeDevices();
    const proposalId = await openProposal(h);
    const { yes, no } = forgeConflictingVotes(h, proposalId);
    showTo(h.devices.m0, 'c1', yes);
    showTo(h.devices.m0, 'c1', no);

    const direct = foldDisputes({ events: eventsOn(h.devices.m0) });
    const viaView = new Set((await h.devices.m0.gov.view('c1')).disputed.map((x) => x.ref));
    expect([...viaView]).toEqual([...direct]);
  });
});

describe('3.3 — the deadline override is an ADMIN escape hatch, never a member one', () => {
  it('past the deadline, only Anna may force it — Bram and Cato never see "Decide now"', async () => {
    const h = threeDevices({ clock: 1 });
    const proposalId = await openProposal(h, 100);       // a deadline the harness supplies explicitly

    // Before expiry nobody may override — including the admin. (Non-vacuous control: proves the later
    // `true` is caused by expiry and not by being admin.)
    expect((await h.rowOn('admin0', proposalId)).canOverride).toBe(false);

    h.setClock(101);                                      // the deadline passes
    expect((await h.rowOn('admin0', proposalId)).canOverride).toBe(true);
    expect((await h.rowOn('m0', proposalId)).canOverride).toBe(false);
    expect((await h.rowOn('m1', proposalId)).canOverride).toBe(false);
  });

  it('forcing it lands IDENTICALLY on all three devices', async () => {
    const h = threeDevices({ clock: 1 });
    const proposalId = await openProposal(h, 100);
    h.setClock(101);

    await h.devices.admin0.gov.override({ circleId: 'c1', proposalId, actor: { ref: 'admin0' } });

    for (const ref of ['admin0', 'm0', 'm1']) {
      const row = await h.rowOn(ref, proposalId);
      expect(row.status, `${ref} disagrees about the outcome`).toBe(DECISION_STATUS.APPROVED);
    }
    // …and the real-world effect still happened exactly once, on the admin.
    expect(h.removalsEverywhere().map((r) => r.by)).toEqual(['admin0']);
  });

  it('a MEMBER calling override directly is refused — the gate is in the model, not the button', async () => {
    const h = threeDevices({ clock: 1 });
    const proposalId = await openProposal(h, 100);
    h.setClock(101);

    const res = await h.devices.m0.gov.override({ circleId: 'c1', proposalId, actor: { ref: 'm0' } });
    expect(res.status).not.toBe(DECISION_STATUS.APPROVED);
    expect(h.removalsEverywhere()).toEqual([]);           // nothing was enacted anywhere
    expect((await h.rowOn('admin0', proposalId)).status).toBe(DECISION_STATUS.PENDING);
  });

  // ✅ FIXED 2026-07-26. No shell ever passed a `deadline`, so `expired` was never true and a proposal short
  // of quorum stayed open forever. The default now comes from the circle's own policy — the
  // `decisionDeadline` enum axis (default '7d'), resolved by `decisionDeadlineDays` and applied in
  // `makeGovernanceOrchestrator.propose`. In the MODEL, so both shells inherit it rather than each
  // remembering to pass one; and an ENUM so it lands in the shared settings radio surface an admin can use.
  it('a proposal opened the way the SHELLS open it can eventually be overridden', async () => {
    const h = threeDevices({ clock: 1 });
    const proposalId = await openProposal(h, null);       // exactly what the shells pass
    expect((await h.rowOn('admin0', proposalId)).canOverride).toBe(false);   // not yet — the week is running

    h.setClock(1 + 8 * 86_400_000);                       // eight days later
    expect((await h.rowOn('admin0', proposalId)).canOverride).toBe(true);
    expect((await h.rowOn('m0', proposalId)).canOverride).toBe(false);       // still admin-only
  });

  it('a circle may opt OUT of the hatch with `decisionDeadline: open-ended`', async () => {
    const h = threeDevices({
      clock: 1,
      policy: normalizeCirclePolicy({ governance: { removeMember: 'member-vote' }, decisionDeadline: 'open-ended' }),
    });
    const proposalId = await openProposal(h, null);
    h.setClock(10_000_000_000);
    expect((await h.rowOn('admin0', proposalId)).canOverride).toBe(false);
    expect((await h.rowOn('admin0', proposalId)).deadline).toBe(null);
  });
});

describe('3.6 — a report reaches the admin; it must not reach the person reported', () => {
  const fileReport = (d) => d.gov.reports.file({
    circleId: 'c1', targetType: 'post', targetRef: 'post-7', targetLabel: 'Bram\'s post',
    reason: 'Cato says this is harassment',
  });

  it('Anna (admin) sees the report Cato filed', async () => {
    const h = threeDevices();
    await fileReport(h.devices.m1);                        // Cato reports Bram's post

    const open = (await h.devices.admin0.gov.reports.list('c1')).open;
    expect(open).toHaveLength(1);
    expect(open[0].by).toBe('m1');
    expect(open[0].targetRef).toBe('post-7');
  });

  it('acting on it removes the post, and the report closes on every device', async () => {
    const h = threeDevices();
    const { reportId } = await fileReport(h.devices.m1);
    await h.devices.admin0.gov.reports.act({ circleId: 'c1', reportId });

    expect(h.devices.admin0.removed).toEqual([{ circleId: 'c1', targetType: 'post', targetRef: 'post-7' }]);
    for (const ref of ['admin0', 'm0', 'm1']) {
      const { open } = await h.devices[ref].gov.reports.list('c1');
      expect(open.map((r) => r.reportId), `${ref} still shows it open`).not.toContain(reportId);
    }
  });

  it('the reporter can see their OWN report', async () => {
    const h = threeDevices();
    await fileReport(h.devices.m1);
    const mine = (await h.devices.m1.gov.reports.list('c1')).open.filter((r) => r.by === 'm1');
    expect(mine).toHaveLength(1);
  });

  // ✅ FIXED 2026-07-26, in two layers. (1) ROUTING: `appendReportEvent` now fans only to the circle's admin
  // refs (`opts.to`, threaded through both shells into `broadcastKringReport`), so the payload never reaches
  // the reported person's device at all. (2) ACCESS: `reports.list` is viewer-scoped — admin sees all,
  // anyone else sees only what they filed — so a report that lands on a device anyway (an admin demoted
  // after delivery, a replayed log) still is not served. The shells' `if (isAdmin)` is now redundant rather
  // than load-bearing.
  it('Bram — the person reported — does not hold the report payload', async () => {
    const h = threeDevices();
    await fileReport(h.devices.m1);

    const { open } = await h.devices.m0.gov.reports.list('c1');
    expect(open.map((r) => r.targetRef)).not.toContain('post-7');
  });

  it('layer 1 (routing): the report event never lands in a non-admin\'s log', async () => {
    const h = threeDevices();
    await fileReport(h.devices.m1);

    // Bram is neither the reporter nor an admin — his raw log must not carry the event at all.
    const bramsReports = h.devices.m0.log.query({}).filter((e) => e.type === 'report');
    expect(bramsReports).toHaveLength(0);
    // Anna (admin) does hold it — proving the fan still works and the empty log above is not vacuous.
    expect(h.devices.admin0.log.query({}).filter((e) => e.type === 'report').length).toBeGreaterThan(0);
  });

  it('layer 2 (access): even holding the event, a non-admin is not served it', async () => {
    const h = threeDevices();
    await fileReport(h.devices.m1);

    // Force the event onto Bram's device, bypassing the narrowed fan — the demoted-admin / replay case.
    const ev = h.devices.admin0.log.query({}).find((e) => e.type === 'report').payload;
    h.devices.m0.ingestReport(null, { subtype: 'kring-report-broadcast', circleId: 'c1', event: ev, ts: Date.now() });
    expect(h.devices.m0.log.query({}).filter((e) => e.type === 'report')).toHaveLength(1);   // he holds it…

    const { open, scope } = await h.devices.m0.gov.reports.list('c1');
    expect(scope).toBe('own');                                       // …but is served only his own
    expect(open).toHaveLength(0);
  });

  it('the REPORTER learns the outcome — narrowing the fan must not strand them', async () => {
    // The regression narrowing the fan introduces if the recipient set is admins ALONE: the resolve event
    // never reaches Cato, so his own report sits "open" on his device forever. The fan is admins ∪ reporter.
    const h = threeDevices();
    const { reportId } = await fileReport(h.devices.m1);
    expect((await h.devices.m1.gov.reports.list('c1')).open.map((r) => r.reportId)).toEqual([reportId]);

    await h.devices.admin0.gov.reports.act({ circleId: 'c1', reportId });

    const cato = await h.devices.m1.gov.reports.list('c1');
    expect(cato.open).toHaveLength(0);                               // it closed on his device too
    expect(cato.resolved.map((r) => r.reportId)).toContain(reportId);
    // …and Bram, who is neither, still holds nothing at all.
    expect(h.devices.m0.log.query({}).filter((e) => e.type === 'report')).toHaveLength(0);
  });

  it('an admin still sees the whole picture — the scope marker says so', async () => {
    const h = threeDevices();
    await fileReport(h.devices.m1);
    const { open, scope } = await h.devices.admin0.gov.reports.list('c1');
    expect(scope).toBe('all');
    expect(open).toHaveLength(1);
    expect(open[0].reason).toContain('harassment');
  });
});
