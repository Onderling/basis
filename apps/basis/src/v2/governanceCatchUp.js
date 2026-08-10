/**
 * governanceCatchUp — pull-all catch-up for the governance lane (the reliable tier's second half).
 *
 * Live fan covers ONLINE members; this covers the device that was OFFLINE while the circle decided things:
 * on reconnect it asks a peer for the circle's governance statements and ingests them through the SAME rail
 * gate the live fan uses (signature + declared kind + key↔ref binding; idempotent by stable id). PULL-ALL,
 * no cursor: governance statements are causally chained (no meaningful wall-clock window), the set is small
 * (bounded by decision churn, not chat volume), and re-delivery is free — so completeness is cheap, and for
 * a deny-wins lane completeness is the point: a missed vote or resolve is a lingering divergence.
 *
 * Transport: one request/one batch over the existing peer router — no new channel, no negotiation (the
 * chat protocol's offer/mode machinery exists because chat is big and windowed; governance is neither).
 */
import { GOV_EVENT } from './governanceLog.js';

export const GOV_CATCHUP_REQUEST = 'kring-governance-catchup-request';
export const GOV_CATCHUP_BATCH   = 'kring-governance-catchup-batch';

/** Far above any real circle's decision count; a runaway/hostile batch is truncated, never trusted. */
const MAX_BATCH = 500;

/**
 * @param {object} deps
 * @param {{ storedStatements: Function, ingest: Function }} deps.rail  the governance rail (makeGovernanceRail)
 * @param {(peerAddr: string, payload: object) => Promise<*>|*} deps.sendToPeer
 * @param {(circleId: string) => void} [deps.onChange]   re-render an open panel after a batch lands
 * @param {(fromPeerAddr: string, circleId: string) => Promise<boolean>|boolean} [deps.mayServe]
 *   whether to answer this peer's request. Default: serve (the V1 catch-up posture — every kring member is a
 *   known peer, and every statement is a SIGNED fact the receiver re-verifies; the residual exposure is the
 *   proposal/vote metadata itself, the same the live fan already carries). Wire a roster check to narrow.
 */
export function makeGovernanceCatchUp({ rail, sendToPeer, onChange = null, mayServe = null, subtypes = null } = {}) {
  // Lane-parametrized: the governance pair by default; a second lane (membership) passes its own pair —
  // one mechanism, per-lane wire names. (Content lanes don't use this — they ride the windowed
  // `frontierReplay`; pull-all is for the small deny-wins lanes where completeness is the point.)
  const REQ = subtypes?.request ?? GOV_CATCHUP_REQUEST;
  const BATCH = subtypes?.batch ?? GOV_CATCHUP_BATCH;
  if (!rail || typeof rail.storedStatements !== 'function' || typeof rail.ingest !== 'function') {
    throw new Error('governanceCatchUp: a governance rail (storedStatements + ingest) is required');
  }
  if (typeof sendToPeer !== 'function') throw new Error('governanceCatchUp: sendToPeer required');

  /** SERVE — a reconnecting peer asks for a circle's governance statements; reply with all of them. */
  async function onRequest(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== REQ) return;
    const { circleId } = payload;
    if (typeof circleId !== 'string' || !circleId) return;
    try {
      if (mayServe && !(await mayServe(fromPeerAddr, circleId))) return;
      const statements = rail.storedStatements(circleId).slice(0, MAX_BATCH);
      if (statements.length === 0) return;   // nothing to serve — silence, not an empty batch
      await sendToPeer(fromPeerAddr, { subtype: BATCH, circleId, statements });
    } catch { /* serving is best-effort — the requester retries on its next reconnect */ }
  }

  /** RECEIVE — every statement passes the rail's full ingest gate; unverifiable ones drop, the rest land. */
  async function onBatch(_fromPeerAddr, payload) {
    if (!payload || payload.subtype !== BATCH) return;
    const { circleId, statements } = payload;
    if (typeof circleId !== 'string' || !circleId || !Array.isArray(statements)) return;
    let landed = 0;
    for (const s of statements.slice(0, MAX_BATCH)) {
      try { if ((await rail.ingest(circleId, s))?.ok) landed += 1; } catch { /* one bad statement never blocks the rest */ }
    }
    if (landed > 0 && typeof onChange === 'function') {
      try { onChange(circleId); } catch { /* re-render is best-effort */ }
    }
    return { landed };
  }

  /** Ask one peer for one circle's governance statements. */
  const requestFrom = (peerAddr, circleId) => sendToPeer(peerAddr, { subtype: REQ, circleId });

  /**
   * The reconnect kick: request every circle's governance statements from that circle's reachable members
   * (same member source the chat catch-up uses — `listMyBuurts` + `listGroupRoster` addrs). Best-effort,
   * deduped per (peer, circle); a failed peer costs nothing — any ONE complete peer suffices (pull-all +
   * idempotent ingest converge regardless of who answers).
   */
  async function requestAll({ callSkill }) {
    let buurts = [];
    try { buurts = (await callSkill('stoop', 'listMyBuurts', {}))?.buurts ?? []; } catch { return { requested: 0 }; }
    let requested = 0;
    for (const b of buurts) {
      const circleId = b?.groupId ?? b?.id;
      if (typeof circleId !== 'string' || !circleId) continue;
      let members = [];
      try { members = (await callSkill('stoop', 'listGroupRoster', { groupId: circleId }))?.members ?? []; } catch { continue; }
      for (const m of members) {
        const addr = m?.addr ?? m?.circleAddress ?? null;
        if (typeof addr !== 'string' || !addr) continue;
        try { await requestFrom(addr, circleId); requested += 1; } catch { /* next peer */ }
      }
    }
    return { requested };
  }

  return { onRequest, onBatch, requestFrom, requestAll, subtypes: { request: REQ, batch: BATCH } };
}

/** True when a folded proposal list still has open decisions — the caller may nudge (propose-only wakes). */
export function hasOpenDecisions(fold) {
  return (fold?.proposals ?? []).some((p) => p && !p.closed && p.action);
}

export { GOV_EVENT };
export default makeGovernanceCatchUp;
