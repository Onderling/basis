/**
 * basis v2 — governance proposals: the event model + the fold (Phase 4 §5, L4).
 *
 * Governance rides the ONE circle log stream (`eventLog.js`) as typed entries; this module
 * is the PURE reducer over those entries — no storage, no transport. The host reads the
 * `governance`-kind entries off the log and hands their payloads here; the fold groups them
 * into proposals and resolves each live status through `resolveGovernance` (the tally is
 * always over the full membership). Three event kinds:
 *   propose  — opens a proposal (action, subject, proposer, deadline).
 *   vote     — a member's yes/no on a proposal (last vote per voter wins, in the resolver).
 *   resolve  — records enactment/close (approved & enacted, rejected, or cancelled) so a
 *              settled proposal stops showing as open and keeps its final outcome.
 *
 * See docs/decisions.md (2026-07-25).
 */
import { resolveGovernance, DECISION_STATUS } from './governanceDecision.js';

export const GOVERNANCE_KIND = 'governance';
export const GOV_EVENT = { PROPOSE: 'propose', VOTE: 'vote', RESOLVE: 'resolve' };

/** Open a proposal. `subject` is the target (a member ref for removeMember, a patch key for a rule/policy change). */
export function proposeEvent({ proposalId, action, subject = null, by, deadline = null, at = 0 }) {
  return { kind: GOVERNANCE_KIND, event: GOV_EVENT.PROPOSE, proposalId, action, subject, by, deadline, at };
}
/** Cast a vote on a proposal. */
export function voteEvent({ proposalId, voter, choice, at = 0 }) {
  return { kind: GOVERNANCE_KIND, event: GOV_EVENT.VOTE, proposalId, voter, choice, at };
}
/** Record a proposal's close (its final status + who enacted it). */
export function resolveEvent({ proposalId, status, by = null, at = 0 }) {
  return { kind: GOVERNANCE_KIND, event: GOV_EVENT.RESOLVE, proposalId, status, by, at };
}

/**
 * Reduce a flat list of governance events into resolved proposals.
 *
 * @param {Array<object>} events   governance-kind event payloads (any order)
 * @param {object} deps
 * @param {object} deps.policy     the circle policy (→ decision-class per action)
 * @param {Array<{ref:string, role?:string}>} deps.members  the FULL roster
 * @param {object} [deps.actor]    the viewer/actor (for any-admin authority in the live status)
 * @param {number} [deps.now]      current time (ms) — for deadline evaluation
 * @returns {{proposals: Array<{proposalId, action, subject, by, deadline, votes, closed,
 *            status, decision}>}}
 */
export function foldGovernance(events, { policy, members = [], actor = null, now = 0, disputed = null } = {}) {
  // L3: a disputed author (caught equivocating) has their votes discounted — an equivocator
  // must not be able to sway a decision. `disputed` is a Set of author refs (foldDisputes).
  const isDisputed = disputed instanceof Set ? (ref) => disputed.has(ref) : () => false;
  const byId = new Map();
  const get = (id) => {
    if (!byId.has(id)) byId.set(id, { proposalId: id, action: null, subject: null, by: null, deadline: null, votes: [], closed: false, closedStatus: null, closedBy: null, _proposedAt: 0 });
    return byId.get(id);
  };
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.kind !== GOVERNANCE_KIND || typeof e.proposalId !== 'string') continue;
    const p = get(e.proposalId);
    if (e.event === GOV_EVENT.PROPOSE) {
      // First propose wins the proposal's identity (a re-propose of the same id is ignored).
      if (p.action === null) {
        p.action = e.action; p.subject = e.subject ?? null; p.by = e.by ?? null;
        p.deadline = e.deadline ?? null; p._proposedAt = e.at ?? 0;
      }
    } else if (e.event === GOV_EVENT.VOTE) {
      if (typeof e.voter === 'string' && (e.choice === 'yes' || e.choice === 'no') && !isDisputed(e.voter)) {
        p.votes.push({ voter: e.voter, choice: e.choice, at: e.at ?? 0 });
      }
    } else if (e.event === GOV_EVENT.RESOLVE) {
      p.closed = true; p.closedStatus = e.status ?? null; p.closedBy = e.by ?? null;
    }
  }

  const proposals = [];
  for (const p of byId.values()) {
    if (p.action === null) continue;   // votes/resolves with no matching propose — drop
    const decision = resolveGovernance({ action: p.action, policy, actor, members, votes: p.votes, deadline: p.deadline, now });
    proposals.push({
      proposalId: p.proposalId, action: p.action, subject: p.subject, by: p.by, deadline: p.deadline,
      proposedAt: p._proposedAt, votes: p.votes, closed: p.closed,
      // a closed proposal keeps its recorded outcome; an open one shows the live decision.
      status: p.closed ? (p.closedStatus ?? DECISION_STATUS.REJECTED) : decision.status,
      decision,
    });
  }
  // Stable order: open first, then by proposed time.
  proposals.sort((a, b) => (a.closed === b.closed ? (a.proposedAt ?? 0) - (b.proposedAt ?? 0) : (a.closed ? 1 : -1)));
  return { proposals };
}

/** The still-open proposals (not closed and not yet auto-resolved to a terminal status). */
export function openProposals(fold) {
  return (fold?.proposals ?? []).filter((p) => !p.closed);
}

/**
 * Is this governance event worth NUDGING a member about? A decision OPENING (`propose`) is —
 * it may need their vote. Individual votes + resolves are routine and must not spam every
 * member. The in-app notifier + (future) the relay wake-gate both read this so an open vote
 * nudges, but a busy vote doesn't. (§5 / the `shouldWakeForEntry` intent, governance-specific.)
 */
export function governanceWakeHint(event) {
  return !!event && event.event === GOV_EVENT.PROPOSE;
}

/**
 * A STABLE EventLog entry id for a governance event, so the LOCAL append and any
 * fanned/received copy collapse to the same entry (the EventLog dedups by id). A chained
 * event carries its content hash; fall back to its identity fields otherwise.
 */
export function governanceEntryId(event) {
  if (event && typeof event.hash === 'string' && event.hash) return `gov:${event.hash}`;
  return `gov:${event?.proposalId ?? ''}:${event?.event ?? ''}:${event?.voter ?? event?.by ?? ''}:${event?.at ?? ''}`;
}
