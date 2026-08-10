/**
 * frontierReplay — the generic, WINDOWED lane catch-up: "here are my heads, send me what I'm missing,
 * at most this much".
 *
 * The pull-all catch-up (governance/membership) is right for small deny-wins lanes where completeness is
 * the point. Content lanes (tasks now, chat next) are unbounded — pulling everything is exactly the
 * unnegotiated byte-dump the chat protocol grew its machinery to avoid. This module is the replacement
 * shape, built on what already exists:
 *
 *   - The FRONTIER is the id-set of statement HEAD HASHES — the same `frontier(bodies)` the rail already
 *     chains appends with (`parentHash` + `deps` make every statement reachable from the heads).
 *   - The receiver declares its own `limit` up front — that IS the size negotiation, so the offer/accept
 *     round-trip of the negotiated chat protocol is not needed here.
 *   - Replies are CHUNKED with the shared chunk discipline (`chunkItems` + the registered chunk-size
 *     param), each carrying `seq` and a `done`/`more` tail so the receiver can page.
 *
 * Serve algorithm: mark every statement reachable from the receiver's frontier (a walk over OUR stored
 * bodies through `parentHash`/`deps`), serve the rest oldest-first up to `limit`. A frontier hash this
 * device PRUNED (entries age out; the store row is the durable head) marks nothing — the receiver may be
 * re-sent statements it already has, and its idempotent ingest drops them. `statementsFor` lets a lane
 * extend the serve set (the task lane adds sign-only snapshots of live heads whose entries aged out).
 *
 * Paging: a batch tail with `more:true` makes the receiver re-request with its ADVANCED frontier — but
 * only when the previous round actually landed something new (the no-progress guard, so two peers that
 * have diverged beyond each other's windows never ping-pong).
 */
import { frontier } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { chunkItems, DEFAULT_CHUNK_SIZE } from './catchUpProtocol.js';

/** The most statements one replay round serves. The window a long-offline device converges through —
 *  several rounds page through a bigger backlog. `param()` returns the default (200). */
const REPLAY_WINDOW_LIMIT = param({ key: 'replay.windowLimit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 200 });

/**
 * @param {object} deps
 * @param {{ storedStatements: Function, ingest: Function }} deps.rail  the lane's rail
 * @param {(peerAddr: string, payload: object) => Promise<*>|*} deps.sendToPeer
 * @param {{ request: string, batch: string }} deps.subtypes  the lane's wire pair
 * @param {(circleId: string) => Promise<object[]>|object[]} [deps.statementsFor]  serve-set override
 * @param {(circleId: string) => void} [deps.onChange]
 * @param {(fromPeerAddr: string, circleId: string) => Promise<boolean>|boolean} [deps.mayServe]
 * @param {number} [deps.limit]      per-round statement cap (default the registered window param)
 * @param {number} [deps.chunkSize]  statements per chunk (default the registered chunk-size param)
 */
export function makeFrontierReplay({
  rail, sendToPeer, subtypes, statementsFor = null, onChange = null, mayServe = null,
  limit = REPLAY_WINDOW_LIMIT, chunkSize = DEFAULT_CHUNK_SIZE,
} = {}) {
  if (!rail || typeof rail.storedStatements !== 'function' || typeof rail.ingest !== 'function') {
    throw new Error('frontierReplay: a rail (storedStatements + ingest) is required');
  }
  if (typeof sendToPeer !== 'function') throw new Error('frontierReplay: sendToPeer required');
  if (!subtypes?.request || !subtypes?.batch) throw new Error('frontierReplay: a {request, batch} subtype pair is required');
  const REQ = subtypes.request;
  const BATCH = subtypes.batch;

  /** This device's lane frontier for a circle — the head hashes of its stored statement DAG. */
  const localFrontier = (circleId) => frontier(rail.storedStatements(circleId).map((s) => s.body));

  /** Every hash reachable from `heads` through OUR statements' `parentHash`/`deps` edges. */
  function reachableFrom(heads, statements) {
    const byHash = new Map();
    for (const s of statements) { if (s?.body?.hash) byHash.set(s.body.hash, s.body); }
    const seen = new Set();
    const queue = (Array.isArray(heads) ? heads : []).filter((h) => typeof h === 'string' && h);
    while (queue.length) {
      const h = queue.pop();
      if (seen.has(h)) continue;
      seen.add(h);
      const b = byHash.get(h);
      if (!b) continue;                       // pruned/foreign hash — marks nothing further
      if (b.parentHash) queue.push(b.parentHash);
      for (const d of (Array.isArray(b.deps) ? b.deps : [])) queue.push(d);
    }
    return seen;
  }

  /** SERVE — send what the receiver is missing, oldest-first, chunked, capped at the round limit. */
  async function onRequest(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== REQ) return;
    const { circleId } = payload;
    if (typeof circleId !== 'string' || !circleId) return;
    try {
      if (mayServe && !(await mayServe(fromPeerAddr, circleId))) return;
      const all = typeof statementsFor === 'function'
        ? (await statementsFor(circleId)) ?? []
        : rail.storedStatements(circleId);
      const known = reachableFrom(payload.frontier, all);
      const missing = all.filter((s) => s?.body?.hash && !known.has(s.body.hash));
      if (missing.length === 0) return;       // nothing to serve — silence, the receiver stops paging
      const cap = Number.isFinite(payload.limit) && payload.limit > 0 ? Math.min(payload.limit, limit) : limit;
      const window = missing.slice(0, cap);
      const more = missing.length > window.length;
      const chunks = chunkItems(window, chunkSize);
      for (let i = 0; i < chunks.length; i += 1) {
        await sendToPeer(fromPeerAddr, {
          subtype: BATCH, circleId, statements: chunks[i],
          seq: i, done: i === chunks.length - 1, more,
        });
      }
    } catch { /* serving is best-effort — the requester retries on its next reconnect */ }
  }

  /** RECEIVE — every statement passes the rail's full ingest gate; on a `more` tail with real progress,
   *  page on with the advanced frontier. */
  async function onBatch(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== BATCH) return;
    const { circleId, statements } = payload;
    if (typeof circleId !== 'string' || !circleId || !Array.isArray(statements)) return;
    let landed = 0;
    for (const s of statements) {
      // Only a NEW statement counts as progress — a re-delivered duplicate (`existed`) must not feed the
      // paging guard, or a provider that can no longer relate to our frontier would loop us forever.
      try { const r = await rail.ingest(circleId, s); if (r?.ok && !r.existed) landed += 1; } catch { /* one bad statement never blocks the rest */ }
    }
    if (landed > 0 && typeof onChange === 'function') {
      try { onChange(circleId); } catch { /* re-render is best-effort */ }
    }
    if (payload.done && payload.more && landed > 0 && typeof fromPeerAddr === 'string' && fromPeerAddr) {
      // The no-progress guard: only page on when this round landed something new.
      try { await requestFrom(fromPeerAddr, circleId); } catch { /* next reconnect retries */ }
    }
    return { landed };
  }

  /** Ask one peer for one circle's missing statements (this device's frontier + window). */
  const requestFrom = (peerAddr, circleId) => sendToPeer(peerAddr, {
    subtype: REQ, circleId, frontier: localFrontier(circleId), limit,
  });

  /** The reconnect kick — same roster walk as the pull-all catch-up (any ONE complete peer suffices). */
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

  return { onRequest, onBatch, requestFrom, requestAll, localFrontier, subtypes: { request: REQ, batch: BATCH } };
}

export default makeFrontierReplay;
