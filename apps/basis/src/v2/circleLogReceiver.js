/**
 * basis v2 — governance and report receivers.
 *
 * Both ride the governance rail as SIGNED statements: a fanned vote, proposal, report or resolution lands only through
 * the rail's ingest (signature · chain · declared kind · key↔ref binding · and, for reports, `reportLane.js`'s rule), so
 * an unsigned event is refused. The EventLog dedups by the statement's hash. `onChange` lets the shell re-render an open
 * governance panel.
 */
import { GOVERNANCE_KIND } from './governanceLog.js';
import { isReportStatementKind } from './reportLane.js';

/** Peer handler for `circle-governance-broadcast` → ingest the vote/proposal event locally.
 *  `notify(circleId, event)` fires an IN-APP nudge for wake-worthy events (a decision opened),
 *  not every vote (governanceWakeHint).
 *
 *  THE RAIL: with a `rail`, a fanned governance event is a SIGNED STATEMENT and must pass the
 *  rail's ingest — signature + chain + declared kind + the key↔ref binding — before it lands (P9: the gate
 *  binds at the receiver). A bare unsigned event is then REFUSED (no-backcompat: one path per type). Without
 *  a rail (legacy composition) the unsigned path stands unchanged. */
export function makeCircleGovernancePeerHandler({ eventLog, onChange, notify, rail, onLanded = null } = {}) {
  if (!rail) throw new Error('makeCircleGovernancePeerHandler: a governance rail is required — a fanned statement must verify before it lands');
  {
    return async function onCircleGovernanceRail(fromPeerAddr, payload) {
      if (!payload || payload.subtype !== 'circle-governance-broadcast') return;
      const { circleId, event: statement } = payload;
      if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;   // signed-only
      const id = `${GOVERNANCE_KIND}:${statement.body.hash}`;
      const isNew = eventLog.query({}).every((e) => e.id !== id);
      try {
        const res = await rail.ingest(circleId, statement);
        if (!res?.ok) return;                     // refused: unverifiable — never lands, never notifies
        try { onChange?.(circleId); } catch { /* re-render is best-effort */ }
        // a NEW statement goes on to the person's other devices (the one sibling carry's seam)
        if (isNew && typeof onLanded === 'function') { try { await onLanded(circleId, statement, fromPeerAddr); } catch { /* best-effort */ } }
        if (isNew && typeof notify === 'function' && statement.body.kind === 'propose') {
          // notify gets the flat event shape the legacy path passed (a decision OPENED nudge).
          const { authorRef, ...flat } = statement.body.payload ?? {};
          try { notify(circleId, { ...flat, event: statement.body.kind, proposalId: statement.body.subject }); } catch { /* best-effort */ }
        }
      } catch { /* ingest is best-effort — never throw on a peer message */ }
    };
  }
}

/**
 * Peer handler for `circle-report-broadcast`: a report or its resolution, a SIGNED statement on the governance rail. It
 * lands only through the rail's ingest — signature, key↔ref binding and the report rule (`reportLane.js`: a filing's
 * `by` is its author, a resolution's author an admin). A bare unsigned event is refused. Registered in the lane table
 * (`buildCircleLanes`), so every shell — web, mobile, the box — receives reports the same way.
 */
export function makeCircleReportPeerHandler({ rail, onChange = null } = {}) {
  if (!rail) throw new Error('makeCircleReportPeerHandler: the governance rail is required — a report must verify before it lands');
  return async function onCircleReport(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== 'circle-report-broadcast') return;
    const { circleId, event: statement } = payload;
    if (typeof circleId !== 'string' || !circleId || !statement?.body || !statement?.sig) return;   // signed-only
    if (!isReportStatementKind(statement.body.kind)) return;   // this door carries reports, nothing else of the lane
    try {
      const res = await rail.ingest(circleId, statement);
      if (res?.ok) { try { onChange?.(circleId); } catch { /* re-render is best-effort */ } }
    } catch { /* ingest is best-effort — never throw on a peer message */ }
  };
}
