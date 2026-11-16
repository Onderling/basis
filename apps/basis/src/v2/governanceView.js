/**
 * basis v2 — governance surface view-model (Phase 4 §5, L4, shared).
 *
 * The pure read-model both shells project (web ≡ mobile by construction, like
 * buildMijViewModel). Turns a governance fold into UI-ready rows: what a proposal is, its
 * live tally + deadline, and — for THIS viewer — whether they can vote, how they already
 * voted, and whether the admin override is available. No rendering, no ops; the shells add
 * the platform widgets and call the orchestrator.
 */
import { momentWords } from './whenWords.js';
import { DECISION_STATUS } from './governanceDecision.js';

/**
 * Build a subject → human-NAME resolver from a circle roster (listGroupMembers rows,
 * raw or `normalizeCircleMembers`-normalized). Governance/report subjects are member
 * REFS, and the governance context only carries `{ref, role}` (no names) — so a
 * `labelForSubject` reading THAT can never resolve a name and always shows the raw ref.
 * Resolve from the real roster instead: key by every identifier a row exposes (id ·
 * webid · stableId · ref · addr · handle) so whatever ref shape the subject uses
 * matches; the name is `realName ?? displayName ?? handle`. Returns null when
 * unresolved, so the caller keeps the raw-ref fallback. One shared builder → web ≡ mobile.
 *
 * @param {Array<object>} members  roster rows
 * @returns {(ref:any)=>(string|null)}
 */
export function buildSubjectLabeler(members) {
  const byId = new Map();
  for (const m of Array.isArray(members) ? members : []) {
    if (!m || typeof m !== 'object') continue;
    const name = m.realName || m.displayName || m.handle || null;
    if (!name) continue;
    for (const key of [m.id, m.webid, m.stableId, m.ref, m.addr, m.handle]) {
      if (typeof key === 'string' && key) byId.set(key, name);
    }
  }
  return (ref) => ((typeof ref === 'string' && byId.get(ref)) || null);
}

/** The subjects that are a PERSON: who is removed, whose role changes, and (the hint 'member') whoever made a change. */
const PERSON_SUBJECTS = new Set(['removeMember', 'changeRole', 'member']);

/**
 * THE DECISIONS SCREEN'S ONE LABELER (L897, 2026-11-14): a person subject is named from this device's own roster, or
 * "a member who has left" when the roster no longer holds them, never by the key; a subject that is not a person keeps
 * its value. Both shells hand it to the view (`labelForSubject`), so a proposal's subject, a disputed author and whoever
 * made a change without the vote are named the same way everywhere.
 * @param {Array<object>} members  the roster rows (`listGroupMembers`)
 * @param {Function} t
 * @returns {(subject: unknown, action?: string) => string}
 */
export function subjectLabelerFor(members, t) {
  const nameOf = buildSubjectLabeler(members);
  return (s, action) => {
    if (s == null) return '';
    const name = typeof s === 'string' ? nameOf(s) : null;
    if (name) return name;
    if (PERSON_SUBJECTS.has(action)) return t('circle.governance.member_left');
    return String(s);
  };
}

/** This voter's last choice on a proposal ('yes' | 'no' | null). */
function lastVoteOf(votes, ref) {
  let choice = null; let at = -Infinity;
  for (const v of Array.isArray(votes) ? votes : []) {
    if (v && v.voter === ref && (v.at ?? 0) >= at) { choice = v.choice; at = v.at ?? 0; }
  }
  return choice;
}

/**
 * Who or what a proposal is about, as a line a person reads: a member (a removal; a role change's member), never an
 * object printed as text. A rules or settings change is about the whole circle: no subject line (the action says it).
 */
function subjectLabelOf(p, labelForSubject) {
  if (typeof p.subject === 'string') return labelForSubject(p.subject, p.action);
  if (p.action === 'changeRole' && typeof p.subject?.member === 'string') return labelForSubject(p.subject.member, p.action);
  return '';
}

/**
 * HOW MANY MEMBERS JOINED SINCE A PROPOSAL WAS MADE — a SHOWN hint on an open decision, never a gate (Frits 2026-11-15:
 * no vote freeze for the alpha; a vote counts the roster as it is now). Counted from the join statements this device holds
 * whose signed time (`payload.at`) is after the proposal's own signed time, once per member, and only members who are
 * still on the roster. A join's time is set by the device that wrote it, so a changed client can put any time there:
 * that is why this informs and decides nothing. A join without a time (written before joins carried one) is not counted.
 * @param {Array<{kind:string, subject:string, payload?:{at?:number}}>|null} bodies  the circle's verified membership bodies
 * @param {number} since  the proposal's signed time
 * @param {Array<{ref:string}>} [members]  the roster as it is now
 */
export function joinsSince(bodies, since, members = null) {
  if (!Array.isArray(bodies) || typeof since !== 'number' || !(since > 0)) return 0;
  const current = Array.isArray(members) ? new Set(members.map((m) => m?.ref).filter((r) => typeof r === 'string')) : null;
  const who = new Set();
  for (const b of bodies) {
    if (b?.kind !== 'join' || typeof b.subject !== 'string') continue;
    const at = b.payload?.at;
    if (typeof at !== 'number' || !(at > since)) continue;
    if (current && !current.has(b.subject)) continue;
    who.add(b.subject);
  }
  return who.size;
}

/**
 * @param {object} a
 * @param {{proposals: Array}} a.fold           the governanceLog fold
 * @param {{ref?:string, role?:string}} [a.viewer]  the current member (drives can-vote/override)
 * @param {(subject:any, action:string)=>string} [a.labelForSubject]  humanise the subject (e.g. member ref → name)
 * @returns {{open: Array<object>, closed: Array<object>, hasOpen: boolean}}
 */
export function buildGovernanceView({ fold, viewer = null, labelForSubject = (s) => (s == null ? '' : String(s)), joinedSinceOf = null } = {}) {
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
      subjectLabel: subjectLabelOf(p, labelForSubject),
      by: p.by,
      decisionClass: cls,
      status: p.status,
      closed: !!p.closed,
      tally: p.decision?.tally ?? null,
      deadline: p.deadline ?? null,
      myVote,
      // A member may vote on an OPEN member-vote proposal; an admin also answers an open proposal that waits on the
      // admins (admin-quorum, or a member's proposal under any-admin); admins get the override only once the deadline
      // has passed (escape-hatch b).
      // a drawn sample votes only through the members drawn (the admins, where nobody was left to draw)
      // nothing left to vote on once it is APPROVED (it waits for an admin to enact it): no Yes and No (L897)
      canVote: !p.closed && p.status !== DECISION_STATUS.APPROVED && !!myRef && (cls === 'member-vote'
        || (cls === 'random-sample' && (Array.isArray(p.decision?.sample) && p.decision.sample.length ? p.decision.sample.includes(myRef) : isAdmin))
        || (isAdmin && (cls === 'admin-quorum' || cls === 'any-admin'))),
      sample: Array.isArray(p.decision?.sample) ? p.decision.sample : null,
      canOverride: !p.closed && (cls === 'member-vote' || cls === 'random-sample') && isAdmin && overrideAvailable,
      overrideAvailable,
      approved: p.status === DECISION_STATUS.APPROVED,
      rejected: p.status === DECISION_STATUS.REJECTED,
      pending: p.status === DECISION_STATUS.PENDING,
      // Approved but not yet ENACTED — a proposal only closes once an admin/caretaker device performs the
      // op (Decision A), so this window is real and both shells already render "awaiting an admin" for it.
      // It was dead until 2026-07-26: the flag existed only on `tally()`'s return value, never on a row,
      // so `row.awaitingEnactment` was always undefined and the chip never appeared on either platform.
      awaitingEnactment: p.status === DECISION_STATUS.APPROVED && !p.closed,
      // WHO SEES "ENACT" (L893, 2026-11-14): the default is that an admin enacts explicitly (Decision B), and only an
      // admin/caretaker device enacts (Decision A); a caretaker IS an admin in the roster. Everyone else keeps the
      // waiting line. One decision both shells read.
      canEnact: p.status === DECISION_STATUS.APPROVED && !p.closed && isAdmin,
      // HOW MANY OF TODAY'S MEMBERS JOINED SINCE THIS PROPOSAL WAS MADE (a shown hint, never a gate: the vote counts the
      // roster as it is now, and a join's time is self-declared): the screen says it on an open decision when it is not 0
      joinedSince: !p.closed && typeof joinedSinceOf === 'function' ? (Number(joinedSinceOf(p)) || 0) : 0,
    };
  });

  const open = rows.filter((r) => !r.closed);
  return { open, closed: rows.filter((r) => r.closed), hasOpen: open.length > 0 };
}

/** The line an open decision shows when members joined since it was made (null at 0): one wording both shells paint. */
export function joinedSinceLine(count, { t } = {}) {
  const n = Number(count) || 0;
  if (n <= 0 || typeof t !== 'function') return null;
  return n === 1 ? t('circle.governance.joined_since_one') : t('circle.governance.joined_since_n', { count: n });
}

/**
 * A vote's deadline line, the same on both shells: "sluit morgen om 09:30" (or the date), "gesloten" once past;
 * '' when the vote has none.
 * @param {number|string|Date|null} deadline
 * @param {{t: Function, now?: Date, locale?: string}} o
 */
export function deadlineLine(deadline, { t, now = new Date(), locale } = {}) {
  if (deadline == null) return '';
  const when = momentWords(deadline, { t, now, locale });
  if (!when) return '';
  return when === t('circle.when.closed') ? when : t('circle.governance.deadline', { when });
}

/**
 * A VOTE THAT FAILED MUST NOT LOOK CAST (L887, 2026-11-14): the line a shell shows after a vote, from what the vote
 * answered. Null when it went through (pending, approved, awaiting an admin's enactment); the failure line when it was
 * refused, threw, or answered nothing. Both shells paint it; neither decides it.
 * @param {unknown} result  what `governance.vote` resolved to, or the error it threw
 * @returns {string|null} a locale key
 */
export function voteFailedLine(result) {
  return result && typeof result === 'object' && !(result instanceof Error) && result.ok === true ? null : 'circle.governance.vote_failed';
}

/**
 * ENACTING SAYS WHAT IT DID, OR WHY IT COULD NOT (L893, 2026-11-14): the line after an admin's Enact, from what the
 * handle's `tally` answered. Done when it enacted (or the proposal is closed now); otherwise it could not, and it must
 * not look done. Both shells paint it; neither decides it.
 * @param {unknown} result
 * @returns {{key: string, failed: boolean}}
 */
export function enactOutcomeLine(result) {
  const done = !!result && typeof result === 'object' && !(result instanceof Error) && result.ok !== false && (result.enacted === true || result.closed === true);
  return done ? { key: 'circle.governance.enacted', failed: false } : { key: 'circle.governance.enact_failed', failed: true };
}

/**
 * A REPORT'S TARGET, NAMED BY THE ADMIN'S OWN ROSTER (L897, 2026-11-14): a member is named as the admin's roster names
 * them (the same labeler a proposal's subject uses), "a member who has left" when the roster no longer holds them, never
 * by the key and never by the name the reporter chose. A post or a message keeps the reporter's own words about it
 * (no roster names those), or just its kind. Both shells paint this line; neither decides it.
 * @param {{targetType: string, targetRef?: string|null, targetLabel?: string|null}} report
 * @param {{nameOf: (ref: string) => string|null, t: Function}} a
 * @returns {string}
 */
export function reportTargetText(report, { nameOf, t } = {}) {
  const kind = t(`circle.governance.report_target.${report?.targetType}`);
  if (report?.targetType === 'member') {
    const name = (typeof nameOf === 'function' ? nameOf(report.targetRef) : null) ?? t('circle.governance.member_left');
    return `${kind}: ${name}`;
  }
  const label = typeof report?.targetLabel === 'string' && report.targetLabel.trim() ? report.targetLabel.trim() : null;
  return label ? `${kind}: ${label}` : kind;
}
