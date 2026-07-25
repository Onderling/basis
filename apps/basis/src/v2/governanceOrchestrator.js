/**
 * basis v2 — governance orchestrator (Phase 4 §5, L4 slice 2).
 *
 * The member-side handler that routes a governed action through its decision-class instead
 * of straight to the op. Pure orchestration over injected seams (like shareDisclosureToCircle):
 *   - appendEvent(circleId, event)      — write a governance event to the one log stream.
 *   - enact(circleId, action, subject)  — the REAL op (removeMember / setCirclePolicy / …),
 *                                         mapped by the host; called only once APPROVED.
 *   - getContext(circleId) → { policy, members, events }  — current policy + full roster +
 *                                         the folded governance events, read back off the log.
 *   - newProposalId()                   — a fresh proposal id.
 *   - now()                             — current ms (deadline evaluation).
 *
 * Flow: `any-admin` by an admin enacts immediately (with a propose+resolve audit trail);
 * `admin-quorum` / `member-vote` open a proposal (auto-casting the proposer's yes), then each
 * `vote` re-tallies and enacts the moment the threshold is met — or rejects when impossible.
 * `override` is the admin's past-deadline valve. Enacting is done via the existing op, so this
 * never reimplements removal/rotation — it gates them.
 */
import { resolveGovernance, DECISION_STATUS } from './governanceDecision.js';
import { proposeEvent, voteEvent, resolveEvent, foldGovernance } from './governanceLog.js';

export function makeGovernanceOrchestrator({ appendEvent, enact, getContext, newProposalId, now = () => 0 } = {}) {
  async function enactAndClose(circleId, proposal, by) {
    let ok = true;
    try { const r = await enact(circleId, proposal.action, proposal.subject); ok = r?.ok !== false; }
    catch { ok = false; }
    await appendEvent(circleId, resolveEvent({
      proposalId: proposal.proposalId, status: ok ? DECISION_STATUS.APPROVED : DECISION_STATUS.REJECTED, by, at: now(),
    }));
    return ok;
  }

  // Re-read the log, resolve the proposal's status, and act on a terminal result.
  async function tally({ circleId, proposalId, enactor = null }) {
    const ctx = await getContext(circleId);
    const fold = foldGovernance(ctx.events, { policy: ctx.policy, members: ctx.members, now: now() });
    const p = (fold.proposals ?? []).find((x) => x.proposalId === proposalId);
    if (!p) return { ok: false, reason: 'no-proposal' };
    if (p.closed) return { ok: true, status: p.status, proposalId, closed: true };
    if (p.status === DECISION_STATUS.APPROVED) {
      const ok = await enactAndClose(circleId, p, enactor);
      return { ok, status: DECISION_STATUS.APPROVED, proposalId, enacted: ok };
    }
    if (p.status === DECISION_STATUS.REJECTED) {
      await appendEvent(circleId, resolveEvent({ proposalId, status: DECISION_STATUS.REJECTED, by: enactor, at: now() }));
      return { ok: true, status: DECISION_STATUS.REJECTED, proposalId, closed: true };
    }
    return { ok: true, status: DECISION_STATUS.PENDING, proposalId, tally: p.decision.tally, deadline: p.deadline };
  }

  async function propose({ circleId, action, subject = null, actor = null, deadline = null }) {
    const ctx = await getContext(circleId);
    const t = now();
    const immediate = resolveGovernance({ action, policy: ctx.policy, actor, members: ctx.members, votes: [], now: t });
    if (!immediate.decisionClass) return { ok: false, reason: 'unknown-action' };

    // any-admin — enact now (an admin's unilateral call), leaving a propose+resolve audit trail.
    if (immediate.decisionClass === 'any-admin') {
      if (immediate.status !== DECISION_STATUS.APPROVED) return { ok: false, status: immediate.status, reason: immediate.reason };
      const proposalId = newProposalId();
      await appendEvent(circleId, proposeEvent({ proposalId, action, subject, by: actor?.ref, deadline: null, at: t }));
      const ok = await enactAndClose(circleId, { proposalId, action, subject }, actor?.ref);
      return { ok, status: ok ? DECISION_STATUS.APPROVED : DECISION_STATUS.REJECTED, proposalId, enacted: ok };
    }

    // admin-quorum / member-vote — open the proposal, auto-cast the proposer's yes, then tally.
    const proposalId = newProposalId();
    await appendEvent(circleId, proposeEvent({ proposalId, action, subject, by: actor?.ref, deadline, at: t }));
    if (actor?.ref) await appendEvent(circleId, voteEvent({ proposalId, voter: actor.ref, choice: 'yes', at: t }));
    return tally({ circleId, proposalId, enactor: actor?.ref });
  }

  async function vote({ circleId, proposalId, voter, choice }) {
    if (choice !== 'yes' && choice !== 'no') return { ok: false, reason: 'bad-choice' };
    await appendEvent(circleId, voteEvent({ proposalId, voter, choice, at: now() }));
    return tally({ circleId, proposalId, enactor: voter });
  }

  // The admin past-deadline valve (escape-hatch b): force a still-pending member-vote.
  async function override({ circleId, proposalId, actor = null }) {
    const ctx = await getContext(circleId);
    const fold = foldGovernance(ctx.events, { policy: ctx.policy, members: ctx.members, actor, now: now() });
    const p = (fold.proposals ?? []).find((x) => x.proposalId === proposalId);
    if (!p || p.closed) return { ok: false, reason: 'no-open-proposal' };
    const d = resolveGovernance({
      action: p.action, policy: ctx.policy, actor, members: ctx.members, votes: p.votes,
      deadline: p.deadline, now: now(), override: true,
    });
    if (d.status !== DECISION_STATUS.APPROVED) return { ok: false, status: d.status, reason: d.reason };
    const ok = await enactAndClose(circleId, p, actor?.ref);
    return { ok, status: ok ? DECISION_STATUS.APPROVED : DECISION_STATUS.REJECTED, proposalId, reason: 'admin-override' };
  }

  return { propose, vote, override, tally };
}
