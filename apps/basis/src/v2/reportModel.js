/**
 * basis v2 — reporting model (Phase 4 §8, Wave C).
 *
 * A first-class **report** flow: a member reports a noticeboard post, a chat message, or a
 * member (with a reason); the report opens the member↔admin lane — it surfaces to the
 * circle's admins, who can **dismiss** it or **act** on it. Acting on a member routes through
 * the governance `removeMember` decision-class (so a member-vote circle puts the ban to a
 * vote), reusing the L4 machinery rather than a bespoke ban path.
 *
 * Pure model: report events ride the one log stream (kind `report`); this is the reducer.
 * Two events:
 *   report  — files a report (target + reason + reporter).
 *   resolve — closes it with an outcome (`dismissed` | `actioned`).
 * See docs/decisions.md (2026-07-25) + the Phase-4 design §8.
 */
export const REPORT_KIND = 'report';
export const REPORT_EVENT = { REPORT: 'report', RESOLVE: 'resolve' };
export const REPORT_TARGETS = ['post', 'message', 'member'];
export const REPORT_STATUS = { OPEN: 'open', DISMISSED: 'dismissed', ACTIONED: 'actioned' };

/** File a report against a target. `targetRef` is the item/message id or the member ref. */
export function reportEvent({ reportId, targetType, targetRef, targetLabel = null, reason = '', by, at = 0 }) {
  return { kind: REPORT_KIND, event: REPORT_EVENT.REPORT, reportId, targetType, targetRef, targetLabel, reason, by, at };
}
/** Close a report with an outcome (`dismissed` | `actioned`). */
export function resolveReportEvent({ reportId, outcome, by = null, at = 0 }) {
  return { kind: REPORT_KIND, event: REPORT_EVENT.RESOLVE, reportId, outcome, by, at };
}

/**
 * Reduce report events into reports. First `report` wins a report's identity; a `resolve`
 * closes it with its recorded outcome. Ordered open-first, then by filing time.
 * @param {Array<object>} events  report-kind event payloads (any order)
 * @returns {{open: Array<object>, resolved: Array<object>, openCount: number}}
 */
export function foldReports(events) {
  const byId = new Map();
  const get = (id) => {
    if (!byId.has(id)) byId.set(id, { reportId: id, targetType: null, targetRef: null, targetLabel: null, reason: '', by: null, at: 0, closed: false, outcome: null, closedBy: null });
    return byId.get(id);
  };
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.kind !== REPORT_KIND || typeof e.reportId !== 'string') continue;
    const r = get(e.reportId);
    if (e.event === REPORT_EVENT.REPORT) {
      if (r.targetType === null && REPORT_TARGETS.includes(e.targetType)) {
        r.targetType = e.targetType; r.targetRef = e.targetRef ?? null; r.targetLabel = e.targetLabel ?? null;
        r.reason = typeof e.reason === 'string' ? e.reason : ''; r.by = e.by ?? null; r.at = e.at ?? 0;
      }
    } else if (e.event === REPORT_EVENT.RESOLVE) {
      r.closed = true; r.outcome = e.outcome ?? REPORT_STATUS.DISMISSED; r.closedBy = e.by ?? null;
    }
  }
  const rows = [];
  for (const r of byId.values()) {
    if (r.targetType === null) continue;   // a resolve with no matching report — drop
    rows.push({
      reportId: r.reportId, targetType: r.targetType, targetRef: r.targetRef, targetLabel: r.targetLabel,
      reason: r.reason, by: r.by, at: r.at, closed: r.closed,
      status: r.closed ? (r.outcome ?? REPORT_STATUS.DISMISSED) : REPORT_STATUS.OPEN,
    });
  }
  rows.sort((a, b) => (a.closed === b.closed ? (a.at ?? 0) - (b.at ?? 0) : (a.closed ? 1 : -1)));
  return { open: rows.filter((r) => !r.closed), resolved: rows.filter((r) => r.closed), openCount: rows.filter((r) => !r.closed).length };
}
