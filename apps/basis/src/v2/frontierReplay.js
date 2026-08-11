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
 *   - The receiver declares its own `limit` up front — that IS the size negotiation for ordinary rounds.
 *     One consent rung survives, THRESHOLD-GATED (the chat-lane sitting): above the provider's
 *     `offerThreshold` the provider sends a SIZE SIGNAL (an offer: count + approx bytes) instead of
 *     streaming, and serves only a request carrying an explicit `allowance`. The receiver auto-allows up
 *     to its `autoAllow` ceiling (system lanes never prompt anyone); above that the `onOffer` seam lets a
 *     chat surface ask the user the real question before the bytes move.
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
import { chunkItems, DEFAULT_CHUNK_SIZE } from './chunking.js';

/** The most statements one replay round serves. The window a long-offline device converges through —
 *  several rounds page through a bigger backlog. `param()` returns the default (200). */
const REPLAY_WINDOW_LIMIT = param({ key: 'replay.windowLimit', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 200 });
/** Above this many missing statements the PROVIDER answers with a size signal (an OFFER) instead of
 *  streaming, and serves only after the receiver re-requests with an explicit allowance. */
const REPLAY_OFFER_THRESHOLD = param({ key: 'replay.offerThreshold', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 200 });
/** Up to this many offered statements the RECEIVER allows automatically (system lanes never prompt);
 *  above it the offer is handed to the lane's `onOffer` seam — chat surfaces the real question there. */
const REPLAY_AUTO_ALLOW = param({ key: 'replay.autoAllow', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 200 });

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
 * @param {number} [deps.offerThreshold]  provider: above this many missing, offer first (default param)
 * @param {number} [deps.autoAllow]  receiver: auto-allow offers up to this size (default param)
 * @param {(offer: {peerAddr:string, circleId:string, count:number, approxBytes:number, allow:()=>Promise<*>}) => void} [deps.onOffer]
 *   the consent seam for offers ABOVE the auto-allow ceiling — a chat surface shows the real question and
 *   calls `allow()` when the user says yes. Absent → the offer waits (nothing downloads).
 */
export function makeFrontierReplay({
  rail, sendToPeer, subtypes, statementsFor = null, onChange = null, mayServe = null,
  limit = REPLAY_WINDOW_LIMIT, chunkSize = DEFAULT_CHUNK_SIZE,
  offerThreshold = REPLAY_OFFER_THRESHOLD, autoAllow = REPLAY_AUTO_ALLOW, onOffer: offerSeam = null,
} = {}) {
  if (!rail || typeof rail.storedStatements !== 'function' || typeof rail.ingest !== 'function') {
    throw new Error('frontierReplay: a rail (storedStatements + ingest) is required');
  }
  if (typeof sendToPeer !== 'function') throw new Error('frontierReplay: sendToPeer required');
  if (!subtypes?.request || !subtypes?.batch) throw new Error('frontierReplay: a {request, batch} subtype pair is required');
  const REQ = subtypes.request;
  const BATCH = subtypes.batch;
  const OFFER = subtypes.offer ?? `${REQ}-offer`;

  /** This device's lane frontier for a circle — the head hashes of its stored statement DAG. */
  const localFrontier = (circleId) => frontier(rail.storedStatements(circleId).map((s) => s.body));

  /** Approximate wire size of a statement set — a small sample extrapolated, so a huge backlog's offer
   *  never costs a full serialization. */
  function approxBytesOf(statements) {
    const sample = statements.slice(0, 20);
    let bytes = 0;
    for (const s of sample) { try { bytes += JSON.stringify(s).length; } catch { /* skip */ } }
    return sample.length ? Math.round((bytes / sample.length) * statements.length) : 0;
  }

  /** Allowances this receiver granted, per `peer|circle` — carried on every subsequent request so paging
   *  through an allowed backlog never re-triggers the offer gate. */
  const granted = new Map();

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
      const allowance = Number.isFinite(payload.allowance) && payload.allowance > 0 ? Math.floor(payload.allowance) : 0;
      // The consent gate (Frits, the chat-lane sitting): above the provider's threshold, do not stream —
      // answer with a SIZE SIGNAL and serve only a request that carries an explicit allowance. Small
      // backlogs flow without ceremony; the gate binds HERE, at the sender (enforceable).
      if (missing.length > offerThreshold && allowance === 0) {
        await sendToPeer(fromPeerAddr, {
          subtype: OFFER, circleId, count: missing.length, approxBytes: approxBytesOf(missing),
        });
        return;
      }
      // An allowance AUTHORIZES the transfer; it does not change the round size — the window + paging
      // discipline stays the same, the receiver just keeps carrying its allowance while it pages.
      const asked = Number.isFinite(payload.limit) && payload.limit > 0 ? Math.floor(payload.limit) : limit;
      const cap = Math.min(asked, limit);
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

  /** RECEIVE AN OFFER — the provider says the backlog is big. Up to the auto-allow ceiling, consent is
   *  automatic (system lanes never prompt); above it the lane's `onOffer` seam decides — a chat surface
   *  shows the real question ("download N messages, ~X MB?") and calls `allow()` on yes. No seam → the
   *  offer waits; nothing downloads. */
  async function onOffer(fromPeerAddr, payload) {
    if (!payload || payload.subtype !== OFFER) return;
    const { circleId, count, approxBytes } = payload;
    if (typeof circleId !== 'string' || !circleId || !Number.isFinite(count) || count < 1) return;
    const allow = () => {
      granted.set(`${fromPeerAddr}|${circleId}`, Math.ceil(count));
      return requestFrom(fromPeerAddr, circleId);
    };
    if (count <= autoAllow) return allow();
    if (typeof offerSeam === 'function') {
      try { offerSeam({ peerAddr: fromPeerAddr, circleId, count, approxBytes: approxBytes ?? 0, allow }); }
      catch { /* the consent surface is best-effort — the offer just waits */ }
    }
  }

  /** Ask one peer for one circle's missing statements (this device's frontier + window + any allowance). */
  const requestFrom = (peerAddr, circleId) => {
    const allowance = granted.get(`${peerAddr}|${circleId}`) ?? 0;
    return sendToPeer(peerAddr, {
      subtype: REQ, circleId, frontier: localFrontier(circleId), limit,
      ...(allowance > 0 ? { allowance } : {}),
    });
  };

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

  return { onRequest, onBatch, onOffer, requestFrom, requestAll, localFrontier, subtypes: { request: REQ, batch: BATCH, offer: OFFER } };
}

export default makeFrontierReplay;
