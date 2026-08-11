/**
 * basis v2 — governance decision-class resolver (Connectivity Phase 4 §5, L4).
 *
 * Pure model: given a governed action, the circle policy, the full membership, and the
 * folded `governance` vote events for one proposal, decide whether it is APPROVED,
 * PENDING, or REJECTED. No I/O, no transport — the host folds the log into `votes` and
 * wires the result to the action. The decision-class comes from the policy
 * (`decisionClassFor`); the tally is always over the FULL proof-derived membership, never
 * the reachable subset, so a partition can't railroad a decision.
 *
 * Three classes (docs/decisions.md 2026-07-25):
 *   any-admin     — an admin's unilateral call (approved iff the actor is an admin).
 *   admin-quorum  — a strict majority of the FULL admin set must vote yes; pends until reached.
 *   member-vote   — a strict majority of the FULL membership must vote yes; pends if the
 *                   threshold is unreachable, with an ADMIN-OVERRIDE valve once past the deadline
 *                   (safety over liveness, escape-hatch (b)).
 */
import { decisionClassFor } from './circlePolicy.js';

export const DECISION_STATUS = { APPROVED: 'approved', PENDING: 'pending', REJECTED: 'rejected' };

/** Strict majority (> half) of `n`. */
function majorityOf(n) { return Math.floor(n / 2) + 1; }

/** Collapse a vote list to each voter's LAST vote (a member may change their mind pre-deadline). */
function finalVotes(votes) {
  // One FINAL vote per voter. The winning revote is decided by the voter's OWN statement chain
  // (`hash`/`parentHash` — a later vote chains after the earlier one), NEVER by the writer-stamped wall
  // clock: a skewed or back-dated clock must not resurrect an old vote, and two devices folding the same
  // statements in different arrival orders must reach the same tally. Where two votes by one voter do not
  // compare on the chain (an equivocation fork — the rail's disputed set discounts real equivocators
  // upstream; here it can only be chain-less legacy events), the tiebreak is DETERMINISTIC: higher `at`,
  // then lexicographically greater hash — the same winner on every device.
  const byVoter = new Map();
  for (const v of Array.isArray(votes) ? votes : []) {
    if (!v || typeof v.voter !== 'string' || (v.choice !== 'yes' && v.choice !== 'no')) continue;
    const list = byVoter.get(v.voter) ?? [];
    list.push(v);
    byVoter.set(v.voter, list);
  }
  const out = [];
  for (const list of byVoter.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const byHash = new Map(list.filter((v) => typeof v.hash === 'string').map((v) => [v.hash, v]));
    // A vote that is an ANCESTOR of another of the same voter's votes is superseded.
    const superseded = new Set();
    for (const v of list) {
      let cursor = typeof v.parentHash === 'string' ? v.parentHash : null;
      const seen = new Set();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        if (byHash.has(cursor)) superseded.add(cursor);
        cursor = typeof byHash.get(cursor)?.parentHash === 'string' ? byHash.get(cursor).parentHash : null;
      }
    }
    const alive = list.filter((v) => !(typeof v.hash === 'string' && superseded.has(v.hash)));
    alive.sort((a, b) => ((b.at ?? 0) - (a.at ?? 0)) || String(b.hash ?? '').localeCompare(String(a.hash ?? '')));
    out.push(alive[0]);
  }
  return out;
}

/**
 * Resolve a governance proposal to a status.
 *
 * @param {object} a
 * @param {string} a.action                     one of GOVERNANCE_ACTIONS
 * @param {object} a.policy                     the circle policy (→ decision-class)
 * @param {{ref:string, role?:string}} [a.actor]  who is asking to resolve now (any-admin / override)
 * @param {Array<{ref:string, role?:string}>} [a.members]  the FULL roster (roles drive thresholds)
 * @param {Array<{voter:string, choice:'yes'|'no', at?:number}>} [a.votes]  folded governance events
 * @param {number|null} [a.deadline]            member-vote deadline (ms); null = open-ended
 * @param {number} [a.now]                      current time (ms) — compared to the deadline
 * @param {boolean} [a.override]                an admin is explicitly forcing a past-deadline vote
 * @returns {{status:string, decisionClass:string|null, reason:string, tally?:object,
 *            deadline?:number|null, overrideAvailable?:boolean}}
 */
export function resolveGovernance({ action, policy, actor = null, members = [], votes = [], deadline = null, now = 0, override = false } = {}) {
  const decisionClass = decisionClassFor(policy, action);
  if (!decisionClass) return { status: DECISION_STATUS.REJECTED, decisionClass: null, reason: 'unknown-action' };

  const roster = Array.isArray(members) ? members.filter((m) => m && typeof m.ref === 'string') : [];
  const admins = roster.filter((m) => m.role === 'admin');
  const isAdmin = (ref) => admins.some((a) => a.ref === ref);
  const final = finalVotes(votes);
  const yes = final.filter((v) => v.choice === 'yes');
  const no  = final.filter((v) => v.choice === 'no');

  if (decisionClass === 'any-admin') {
    if (actor && isAdmin(actor.ref)) return { status: DECISION_STATUS.APPROVED, decisionClass, reason: 'admin' };
    return { status: DECISION_STATUS.REJECTED, decisionClass, reason: 'not-admin' };
  }

  if (decisionClass === 'admin-quorum') {
    const need = majorityOf(admins.length);
    const adminYes = yes.filter((v) => isAdmin(v.voter)).length;
    const adminNo  = no.filter((v) => isAdmin(v.voter)).length;
    const tally = { yes: adminYes, no: adminNo, need, of: admins.length };
    if (admins.length === 0) return { status: DECISION_STATUS.PENDING, decisionClass, reason: 'no-admins', tally };
    if (adminYes >= need) return { status: DECISION_STATUS.APPROVED, decisionClass, reason: 'quorum', tally };
    // Enough admins voted no that a yes-majority can no longer be reached → reject early.
    if (adminNo > admins.length - need) return { status: DECISION_STATUS.REJECTED, decisionClass, reason: 'quorum-impossible', tally };
    return { status: DECISION_STATUS.PENDING, decisionClass, reason: 'awaiting-admins', tally };
  }

  // member-vote — strict majority of the FULL membership.
  const need = majorityOf(roster.length);
  const tally = { yes: yes.length, no: no.length, need, of: roster.length };
  const expired = deadline != null && now >= deadline;
  if (yes.length >= need) return { status: DECISION_STATUS.APPROVED, decisionClass, reason: 'majority', tally, deadline };
  // A no-majority makes the yes-threshold unreachable → reject (no deadlock, and it's a clear NO).
  if (no.length > roster.length - need) return { status: DECISION_STATUS.REJECTED, decisionClass, reason: 'rejected-by-majority', tally, deadline };
  // Threshold not (yet) reached. Escape-hatch (b): once past the deadline an admin may force it.
  if (expired && override && actor && isAdmin(actor.ref)) {
    return { status: DECISION_STATUS.APPROVED, decisionClass, reason: 'admin-override', tally, deadline };
  }
  return {
    status: DECISION_STATUS.PENDING, decisionClass,
    reason: expired ? 'deadline-passed' : 'awaiting-votes',
    tally, deadline, overrideAvailable: expired,
  };
}
