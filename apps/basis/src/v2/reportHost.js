/**
 * basis v2 — report host (Phase 4 §8, Wave C).
 *
 * Binds the report model to the log + the governance handle. A member FILES a report; an
 * admin LISTS the open reports (the member↔admin lane), then DISMISSES or ACTS. Acting on a
 * **member** target routes through the governance `removeMember` decision-class (any-admin
 * bans immediately; a member-vote circle opens a vote) — reusing L4, never a bespoke ban.
 * Acting on a post/message closes the report `actioned`; the shell wires the item removal.
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
export function makeCircleReports({ readReportEvents, appendReportEvent, governance = null, removeReported = null, newReportId, localActorRef, now = () => 0 }) {
  async function list(circleId) {
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
    const { open } = await list(circleId);
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
