/**
 * basis v2 — report host (Phase 4 §8, Wave C).
 *
 * Binds the report model to the log + the governance handle. A member FILES a report; an
 * admin LISTS the open reports (the member↔admin lane), then DISMISSES or ACTS. Acting on a
 * **member** target routes through the governance `removeMember` decision-class (any-admin
 * bans immediately; a member-vote circle opens a vote) — reusing L4, never a bespoke ban.
 * Acting on a post/message closes the report `actioned`; the shell wires the item removal.
 *
 * VISIBILITY (2026-07-26, story 3.6). `list` is VIEWER-SCOPED: an admin sees every report, anyone else sees
 * only the ones they filed themselves. Until this change `list` returned every report to every caller and the
 * only barrier was an `if (isAdmin)` in each shell — presentation, not access control — so a member's device
 * would hand over the reporter's identity and the free-text reason about them on request. The fan is now
 * admin-only too (see `governanceAppWiring`), which stops the payload arriving; this is the second layer, so
 * a report that reaches a device anyway (an admin demoted after delivery, a replayed log) still is not served.
 */
import { reportEvent, resolveReportEvent, foldReports, REPORT_STATUS } from './reportModel.js';

/**
 * @param {object} deps
 * @param {(circleId:string)=>Promise<Array<object>>} deps.readReportEvents
 * @param {(circleId:string, event:object)=>Promise<*>} deps.appendReportEvent
 * @param {{propose:Function}} deps.governance   the governance handle (for member bans)
 * @param {(circleId:string, targetType:string, targetRef:string)=>Promise<*>} [deps.removeReported]
 *   remove the reported post/message (the shell's delete op); called when an admin ACTS on one.
 * @param {()=>string} deps.newReportId
 * @param {string} deps.localActorRef
 * @param {()=>number} [deps.now]
 */
export function makeCircleReports({ readReportEvents, appendReportEvent, governance = null, removeReported = null, newReportId, localActorRef, now = () => 0, isAdmin = null }) {
  /** May THIS device's user see everyone's reports? Absent an `isAdmin` seam, assume not (deny-by-default). */
  async function viewerIsAdmin(circleId) {
    if (typeof isAdmin !== 'function') return false;
    try { return !!(await isAdmin(circleId)); } catch { return false; }
  }

  /**
   * The reports this viewer may see. Admin ⇒ all; anyone else ⇒ only their own.
   * `{ scope: 'all' | 'own' }` is returned so a surface can say WHY a list is short rather than implying
   * the circle is quiet.
   */
  async function list(circleId) {
    const events = await readReportEvents(circleId);
    const folded = foldReports(Array.isArray(events) ? events : []);
    if (await viewerIsAdmin(circleId)) return { ...folded, scope: 'all' };
    const mine = (rs) => (Array.isArray(rs) ? rs.filter((r) => r && r.by === localActorRef) : []);
    const open = mine(folded.open);
    return { ...folded, open, resolved: mine(folded.resolved), openCount: open.length, scope: 'own' };
  }

  /** The UNFILTERED fold — for the code paths that act on a report the viewer is entitled to act on.
   *  Kept private: `act`/`dismiss` are already admin affordances in the shells, and scoping them through
   *  `list` would make an admin unable to act on a report they can plainly see. */
  async function listAll(circleId) {
    const events = await readReportEvents(circleId);
    return foldReports(Array.isArray(events) ? events : []);
  }

  async function file({ circleId, targetType, targetRef, targetLabel = null, reason = '' }) {
    const reportId = newReportId();
    await appendReportEvent(circleId, reportEvent({ reportId, targetType, targetRef, targetLabel, reason, by: localActorRef, at: now() }));
    return { ok: true, reportId };
  }

  async function dismiss({ circleId, reportId }) {
    await appendReportEvent(circleId, resolveReportEvent({ reportId, outcome: REPORT_STATUS.DISMISSED, by: localActorRef, at: now() }));
    return { ok: true, status: REPORT_STATUS.DISMISSED };
  }

  async function act({ circleId, reportId }) {
    const { open } = await listAll(circleId);
    const r = open.find((x) => x.reportId === reportId);
    if (!r) return { ok: false, reason: 'no-open-report' };
    // A member target → the governance removeMember class decides the ban. A post/message
    // target → remove the reported item (the injected shell op), then close it actioned.
    let governanceResult = null;
    let removed = null;
    if (r.targetType === 'member' && governance && typeof governance.propose === 'function') {
      governanceResult = await governance.propose({ circleId, action: 'removeMember', subject: r.targetRef, actor: { ref: localActorRef } });
    } else if ((r.targetType === 'post' || r.targetType === 'message') && typeof removeReported === 'function') {
      try { removed = await removeReported(circleId, r.targetType, r.targetRef); } catch { removed = { ok: false }; }
    }
    await appendReportEvent(circleId, resolveReportEvent({ reportId, outcome: REPORT_STATUS.ACTIONED, by: localActorRef, at: now() }));
    return { ok: true, status: REPORT_STATUS.ACTIONED, governance: governanceResult, removed };
  }

  return { list, file, dismiss, act };
}
