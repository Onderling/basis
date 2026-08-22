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

export const GOV_CATCHUP_REQUEST = 'circle-governance-catchup-request';
export const GOV_CATCHUP_BATCH   = 'circle-governance-catchup-batch';

/** Far above any real circle's decision count; a runaway/hostile batch is truncated, never trusted. */
const MAX_BATCH = 500;
/** One deferred re-ingest for batch statements refused at verify — long enough for the pull-burst's
 *  sibling batches (membership roles/addresses) to fold, short enough to matter within one connect. */
const RETRY_REFUSED_MS = 2000;

/**
 * @param {object} deps
 * @param {{ storedStatements: Function, ingest: Function }} deps.rail  the governance rail (makeGovernanceRail)
 * @param {(peerAddr: string, payload: object) => Promise<*>|*} deps.sendToPeer
 * @param {(circleId: string) => void} [deps.onChange]   re-render an open panel after a batch lands
 * @param {(fromPeerAddr: string, circleId: string) => Promise<boolean>|boolean} [deps.mayServe]
 *   whether to answer this peer's request. Default: serve (the V1 catch-up posture — every circle member is a
 *   known peer, and every statement is a SIGNED fact the receiver re-verifies; the residual exposure is the
 *   proposal/vote metadata itself, the same the live fan already carries). Wire a roster check to narrow.
 */
export function makeGovernanceCatchUp({ rail, sendToPeer, onChange = null, mayServe = null, subtypes = null, extraStatementsFor = null } = {}) {
  // Lane-parametrized: the governance pair by default; a second lane (membership) passes its own pair —
  // one mechanism, per-lane wire names. (Content lanes don't use this — they ride the windowed
  // `frontierReplay`; pull-all is for the small deny-wins lanes where completeness is the point.)
  const REQ = subtypes?.request ?? GOV_CATCHUP_REQUEST;
  const BATCH = subtypes?.batch ?? GOV_CATCHUP_BATCH;
  if (!rail || typeof rail.storedStatements !== 'function' || typeof rail.ingest !== 'function') {
    throw new Error('governanceCatchUp: a governance rail (storedStatements + ingest) is required');
  }
  if (typeof sendToPeer !== 'function') throw new Error('governanceCatchUp: sendToPeer required');

  /** SERVE — a reconnecting peer asks for a circle's governance statements; reply with all of them.
   *  `extraStatementsFor` adds DURABLE-HEAD statements whose lane entries aged out (the task-lane
   *  relationship: the entry compacts, the head survives elsewhere and is still the ORIGINAL signed
   *  statement — the receiver's ingest gate verifies it exactly like a live one). Deduped by hash. */
  async function onRequest(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== REQ) return;
    const { circleId } = payload;
    if (typeof circleId !== 'string' || !circleId) return;
    try {
      if (mayServe && !(await mayServe(fromPeerAddr, circleId))) return;
      const statements = rail.storedStatements(circleId).slice(0, MAX_BATCH);
      if (typeof extraStatementsFor === 'function') {
        const seen = new Set(statements.map((s) => s?.body?.hash).filter(Boolean));
        try {
          for (const s of (await extraStatementsFor(circleId)) ?? []) {
            if (s?.body?.hash && s?.sig && !seen.has(s.body.hash) && statements.length < MAX_BATCH) {
              seen.add(s.body.hash);
              statements.push(s);
            }
          }
        } catch { /* the durable-head read is best-effort */ }
      }
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
    const refused = [];
    for (const s of statements.slice(0, MAX_BATCH)) {
      try {
        if ((await rail.ingest(circleId, s))?.ok) landed += 1;
        else refused.push(s);
      } catch { /* one bad statement never blocks the rest */ }
    }
    // ONE deferred re-ingest for refusals (idempotent, so a retry is free): a statement can be
    // refused for a reason that is about to stop being true — a pull-burst's batches RACE each
    // other, and a statement whose binding needs facts another lane's batch is still folding
    // (roles, proven addresses) fails now and verifies moments later. Observed live on the relay
    // walk (2026-08-22): the key lane's batch lost its race against the membership fold and the
    // chain was silently dropped until the next boot. A forged statement stays refused — this
    // retries the VERIFY, it never weakens it.
    if (refused.length > 0) {
      setTimeout(async () => {
        let relanded = 0;
        for (const s of refused) {
          try { if ((await rail.ingest(circleId, s))?.ok) relanded += 1; } catch { /* still refused → next reconnect */ }
        }
        if (relanded > 0 && typeof onChange === 'function') {
          try { onChange(circleId); } catch { /* re-render is best-effort */ }
        }
      }, RETRY_REFUSED_MS);
    }
    if (landed > 0 && typeof onChange === 'function') {
      try { onChange(circleId); } catch { /* re-render is best-effort */ }
    }
    return { landed, refused: refused.length };
  }

  /** Ask one peer for one circle's governance statements. */
  const requestFrom = (peerAddr, circleId) => sendToPeer(peerAddr, { subtype: REQ, circleId });

  /**
   * The reconnect kick: request every circle's governance statements from that circle's reachable members
   * (same member source the chat catch-up uses — `listMyCircles` + `listGroupRoster` addrs). Best-effort,
   * deduped per (peer, circle); a failed peer costs nothing — any ONE complete peer suffices (pull-all +
   * idempotent ingest converge regardless of who answers).
   */
  async function requestAll({ callSkill }) {
    let circles = [];
    try { circles = (await callSkill('stoop', 'listMyCircles', {}))?.circles ?? []; } catch { return { requested: 0 }; }
    let requested = 0;
    for (const b of circles) {
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
