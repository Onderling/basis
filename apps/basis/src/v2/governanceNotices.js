/**
 * Governance notices as RENDERED projections — the same door membership notices use (2-TER).
 *
 * "A decision opened" used to be an in-app nudge APPENDED to the log by each shell's peer handler
 * (`gov-notif-…`, `type: 'notification'`, written twice). The proposal statement is already on the log;
 * the conversation renders the line from it. Nothing is written, so nothing can be said twice, and a
 * catch-up shows the line the moment the statement lands. `type: 'notification'` keeps its real job —
 * app-level things routed to threads (a calendar invite, a shared file).
 */
import { GOVERNANCE_KIND, GOV_EVENT } from './governanceLog.js';

export const GOVERNANCE_NOTICE_KEYS = Object.freeze({
  decisionOpened: 'circle.governance.notify_vote_opened',
});

/** What one governance entry means to THIS viewer, or null. Signed statements and the legacy flat shape. */
export function governanceNoticeFor(payload, { viewerId } = {}) {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload.body && typeof payload.body === 'object' ? payload.body : null;
  const kind = body ? body.kind : payload.event;
  if (kind !== GOV_EVENT.PROPOSE) return null;
  const inner = body ? (body.payload ?? {}) : payload;
  const proposer = body ? (inner.authorRef ?? body.author ?? null) : (payload.by ?? null);
  if (viewerId && proposer === viewerId) return null;          // you opened it — you know
  const action = typeof inner.action === 'string' ? inner.action : null;
  if (!action) return null;
  return { notice: 'decisionOpened', action };
}

/**
 * The governance lines a conversation shows, projected from the log — bot rows keyed by the entry id.
 * @param {(notice:string)=>boolean} [a.wants]   the per-kind setting; absent = show all
 */
export function governanceNoticeRows({ events = [], circleId, viewerId, t, wants = null } = {}) {
  if (typeof t !== 'function' || typeof circleId !== 'string' || !circleId || typeof viewerId !== 'string' || !viewerId) return [];
  const out = [];
  for (const e of events ?? []) {
    if (!e || typeof e !== 'object' || e.type !== GOVERNANCE_KIND) continue;
    if ((e.circleId ?? e.payload?.circleId) !== circleId) continue;
    const hit = governanceNoticeFor(e.payload, { viewerId });
    if (!hit) continue;
    if (typeof wants === 'function' && !wants(hit.notice)) continue;
    const text = t(GOVERNANCE_NOTICE_KEYS[hit.notice], { action: t(`circle.governance.action.${hit.action}`) });
    const id = `notice:${e.id}`;
    const ts = typeof e.ts === 'number' ? e.ts : 0;
    out.push({
      id, ts, app: 'basis', type: 'chat-message', actor: 'bot', circleId, circleName: null,
      event: { id, ts, app: 'basis', type: 'chat-message', actor: 'bot',
        payload: { circleId, kind: 'chat-message', scope: 'self', text, notice: hit.notice } },
    });
  }
  return out;
}
