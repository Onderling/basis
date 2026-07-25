/**
 * basis v2 — governance/report ingest receivers (Wave C propagation).
 *
 * Governance rides the ONE circle log; these handlers ingest a fanned governance or report
 * event (from the stoop `broadcastKring{Governance,Report}` skills) into the LOCAL EventLog,
 * so a vote/report raised on one device shows up on every member's device. The EventLog dedups
 * by the STABLE entry id (governanceEntryId / reportEntryId), so a re-delivered event never
 * double-appends. Registered on the peer router under the two broadcast subtypes, next to the
 * chat/policy/rules handlers. `onChange` lets the shell re-render an open governance panel.
 */
import { GOVERNANCE_KIND, governanceEntryId } from './governanceLog.js';
import { REPORT_KIND, reportEntryId } from './reportModel.js';

function makeIngestHandler({ eventLog, subtype, kind, idFor, onChange }) {
  return async function onKringLogBroadcast(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== subtype) return;
    const { circleId, event, ts } = payload;
    if (typeof circleId !== 'string' || !circleId || !event || typeof event !== 'object') return;
    try {
      eventLog.appendSilentEntry({ circleId, kind, payload: event, id: idFor(event), ts });
      try { onChange?.(circleId); } catch { /* re-render is best-effort */ }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}

/** Peer handler for `kring-governance-broadcast` → ingest the vote/proposal event locally. */
export function makeKringGovernancePeerHandler({ eventLog, onChange } = {}) {
  return makeIngestHandler({ eventLog, subtype: 'kring-governance-broadcast', kind: GOVERNANCE_KIND, idFor: governanceEntryId, onChange });
}

/** Peer handler for `kring-report-broadcast` → ingest the report event locally. */
export function makeKringReportPeerHandler({ eventLog, onChange } = {}) {
  return makeIngestHandler({ eventLog, subtype: 'kring-report-broadcast', kind: REPORT_KIND, idFor: reportEntryId, onChange });
}
