/**
 * basis v2 — governance surface view-model (Phase 4 §5, L4 slice 3, shared).
 *
 * The pure read-model both shells project (web ≡ mobile by construction, like
 * buildMijViewModel). Turns a governance fold into UI-ready rows: what a proposal is, its
 * live tally + deadline, and — for THIS viewer — whether they can vote, how they already
 * voted, and whether the admin override is available. No rendering, no ops; the shells add
 * the platform widgets and call the orchestrator.
 */
import { DECISION_STATUS } from './governanceDecision.js';

/** This voter's last choice on a proposal ('yes' | 'no' | null). */
function lastVoteOf(votes, ref) {
  let choice = null; let at = -Infinity;
  for (const v of Array.isArray(votes) ? votes : []) {
    if (v && v.voter === ref && (v.at ?? 0) >= at) { choice = v.choice; at = v.at ?? 0; }
  }
  return choice;
}

/**
 * @param {object} a
 * @param {{proposals: Array}} a.fold           the governanceLog fold
 * @param {{ref?:string, role?:string}} [a.viewer]  the current member (drives can-vote/override)
 * @param {(subject:any, action:string)=>string} [a.labelForSubject]  humanise the subject (e.g. member ref → name)
 * @returns {{open: Array<object>, closed: Array<object>, hasOpen: boolean}}
 */
export function buildGovernanceView({ fold, viewer = null, labelForSubject = (s) => (s == null ? '' : String(s)) } = {}) {
  const proposals = (fold && Array.isArray(fold.proposals)) ? fold.proposals : [];
  const myRef = viewer && typeof viewer.ref === 'string' ? viewer.ref : null;
  const isAdmin = viewer?.role === 'admin';

  const rows = proposals.map((p) => {
    const cls = p.decision?.decisionClass ?? null;
    const overrideAvailable = !!p.decision?.overrideAvailable;
    const myVote = myRef ? lastVoteOf(p.votes, myRef) : null;
    return {
      proposalId: p.proposalId,
      action: p.action,
      subject: p.subject,
      subjectLabel: labelForSubject(p.subject, p.action),
      by: p.by,
      decisionClass: cls,
      status: p.status,
      closed: !!p.closed,
      tally: p.decision?.tally ?? null,
      deadline: p.deadline ?? null,
      myVote,
      // A member may vote on an OPEN member-vote proposal; admins get the override only once
      // the deadline has passed (escape-hatch b). any-admin / admin-quorum aren't member-votable.
      canVote: !p.closed && cls === 'member-vote' && !!myRef,
      canOverride: !p.closed && cls === 'member-vote' && isAdmin && overrideAvailable,
      overrideAvailable,
      approved: p.status === DECISION_STATUS.APPROVED,
      rejected: p.status === DECISION_STATUS.REJECTED,
      pending: p.status === DECISION_STATUS.PENDING,
    };
  });

  const open = rows.filter((r) => !r.closed);
  return { open, closed: rows.filter((r) => r.closed), hasOpen: open.length > 0 };
}
