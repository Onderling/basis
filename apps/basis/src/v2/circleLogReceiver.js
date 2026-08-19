/**
 * basis v2 — governance/report ingest receivers (Wave C propagation).
 *
 * Governance rides the ONE circle log; these handlers ingest a fanned governance or report
 * event (from the stoop `broadcastCircle{Governance,Report}` skills) into the LOCAL EventLog,
 * so a vote/report raised on one device shows up on every member's device. The EventLog dedups
 * by the STABLE entry id (governanceEntryId / reportEntryId), so a re-delivered event never
 * double-appends. Registered on the peer router under the two broadcast subtypes, next to the
 * chat/policy/rules handlers. `onChange` lets the shell re-render an open governance panel.
 */
import { GOVERNANCE_KIND } from './governanceLog.js';
import { REPORT_KIND, reportEntryId } from './reportModel.js';

function makeIngestHandler({ eventLog, subtype, kind, idFor, onChange, notify, wakeHint }) {
  return async function onCircleLogBroadcast(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== subtype) return;
    const { circleId, event, ts } = payload;
    if (typeof circleId !== 'string' || !circleId || !event || typeof event !== 'object') return;
    // Idempotency + not-mine: only nudge if this is genuinely NEW to us (not already logged)
    // and worth attention (wakeHint) — an already-seen re-delivery re-appends to the same id
    // and must NOT re-notify.
    const id = idFor(event);
    const isNew = eventLog.query({}).every((e) => e.id !== id);
    try {
      eventLog.appendSilentEntry({ circleId, kind, payload: event, id, ts });
      try { onChange?.(circleId); } catch { /* re-render is best-effort */ }
      if (isNew && typeof notify === 'function' && (typeof wakeHint !== 'function' || wakeHint(event))) {
        try { notify(circleId, event); } catch { /* in-app nudge is best-effort */ }
      }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}

/** Peer handler for `circle-governance-broadcast` → ingest the vote/proposal event locally.
 *  `notify(circleId, event)` fires an IN-APP nudge for wake-worthy events (a decision opened),
 *  not every vote (governanceWakeHint).
 *
 *  THE RAIL: with a `rail`, a fanned governance event is a SIGNED STATEMENT and must pass the
 *  rail's ingest — signature + chain + declared kind + the key↔ref binding — before it lands (P9: the gate
 *  binds at the receiver). A bare unsigned event is then REFUSED (no-backcompat: one path per type). Without
 *  a rail (legacy composition) the unsigned path stands unchanged. */
export function makeCircleGovernancePeerHandler({ eventLog, onChange, notify, rail } = {}) {
  if (!rail) throw new Error('makeCircleGovernancePeerHandler: a governance rail is required — a fanned statement must verify before it lands');
  {
    return async function onCircleGovernanceRail(_fromPeerAddr, payload) {
      if (!payload || payload.subtype !== 'circle-governance-broadcast') return;
      const { circleId, event: statement } = payload;
      if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;   // signed-only
      const id = `${GOVERNANCE_KIND}:${statement.body.hash}`;
      const isNew = eventLog.query({}).every((e) => e.id !== id);
      try {
        const res = await rail.ingest(circleId, statement);
        if (!res?.ok) return;                     // refused: unverifiable — never lands, never notifies
        try { onChange?.(circleId); } catch { /* re-render is best-effort */ }
        if (isNew && typeof notify === 'function' && statement.body.kind === 'propose') {
          // notify gets the flat event shape the legacy path passed (a decision OPENED nudge).
          const { authorRef, ...flat } = statement.body.payload ?? {};
          try { notify(circleId, { ...flat, event: statement.body.kind, proposalId: statement.body.subject }); } catch { /* best-effort */ }
        }
      } catch { /* ingest is best-effort — never throw on a peer message */ }
    };
  }
}

/** Peer handler for `circle-report-broadcast` → ingest the report event locally. `notify` fires
 *  on every report (an admin should see them). */
export function makeCircleReportPeerHandler({ eventLog, onChange, notify } = {}) {
  return makeIngestHandler({ eventLog, subtype: 'circle-report-broadcast', kind: REPORT_KIND, idFor: reportEntryId, onChange, notify });
}
