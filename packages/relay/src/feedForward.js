/**
 * feedForward — the relay serves a person's agenda link by FORWARDING it to the node that holds the file, holding
 * nothing itself.
 *
 * A household's companion runs where the household is (a tablet beside the bot), with no public port. A calendar app
 * can only fetch a URL, so the link enters through the one public thing the household has: the relay. The link names
 * the companion — `/feed/<node>/<id>.<k>.ics` (`@onderling/blob-gateway`'s `linkPath.js`) — and the relay asks that
 * node, over its live session, `feed.serve({id, k})`; the node opens its sealed file with `k` and answers the text,
 * which the relay passes on and forgets. The relay keeps no map, no file, no key, and opens nothing: it sees the
 * request in flight exactly as the reverse proxy in front of it does.
 *
 * The relay is a broker, not an agent; to ask a node anything it needs a seat at its own table. The SEAT is an agent
 * the relay runs in-process (a fresh key per start, known to nobody in advance) whose wire is the relay's own routing
 * table: what it sends goes to the recipient's live socket or nowhere (never the offline hold, never a wake), and what
 * comes back for it is handed to it before anything else in the `send` path looks at it. It accepts envelopes only
 * from a node it is asking right now.
 *
 * What a fetch can tell anyone (the rules this file keeps):
 *   - one miss: a path that is not a link, a node that does not parse, a node that is away or unknown, a timeout, a
 *     wrong key, no file — all the same 404 with the same body; a path that names no node never reaches the seat;
 *   - no presence oracle: every miss after the path parses answers no sooner than a floor (`relay.feedMissFloorMs`),
 *     so "this address is connected" and "it is not" take the same time (a hit is faster — it needs the link's key);
 *   - nothing logged: neither this handler nor the seat's traffic writes a line (the relay's `log` skips the seat);
 *   - no fan-out: the ask is bounded (15 s), never retried, one in flight per (node, id) — a second identical request
 *     waits for the first and shares its answer, one with another key waits for it and then asks for itself — at most
 *     two in flight per node (a third waits for a place), and a ceiling on all serves in flight together;
 *   - not a way to poke any connected address: anyone who can GET can name any node, a phone included. A node that
 *     REFUSES (it has no `feed.serve`, its gate denies, it answers something that is no answer) is not asked again for
 *     a minute — no hello, the miss at the floor — and concurrent asks to one node share one hello. A companion's own
 *     miss (`{ok: false}`: a wrong key, no file) is an answer, not a refusal, and is never held against it; neither is
 *     a timeout (a slow companion is not a phone).
 *   - `no-store`, `nosniff`, no ETag, on the hit and the miss alike.
 */
import {
  Agent, AgentIdentity, Transport, Parts, allowSender, refuseSender,
  param, PARAM_SCOPE, PARAM_KIND,
} from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { parseFeedLinkPath, LINK_TOKEN } from '@onderling/blob-gateway';
import { timingSafeEqual } from 'node:crypto';

/** The op a node answers a link with — the ONE public op on a companion. */
export const FEED_SERVE_OP = 'feed.serve';

// Parameter register — the forward's bounds (scope:device, kind:internal).
/** How long the relay waits for a node's answer (the hello and the ask together). Never retried. */
export const FEED_SERVE_TIMEOUT_MS = param({ key: 'relay.feedServeTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 15_000 });
/** How many serves may be in flight at once, all nodes together; beyond it a request is a miss. */
export const FEED_MAX_IN_FLIGHT = param({ key: 'relay.feedMaxInFlight', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 32 });
/** How many serves may be in flight to ONE node at once; a further request waits for a place (within the bound). */
export const FEED_MAX_PER_NODE = param({ key: 'relay.feedMaxPerNode', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2 });
/** How long a node that REFUSED (no such op, a policy denial, an answer that is no answer) is not asked again (ms). */
export const FEED_REFUSED_TTL_MS = param({ key: 'relay.feedRefusedTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });
/** No miss after a parsed path answers sooner than this (ms) — away and present take the same time. */
export const FEED_MISS_FLOOR_MS = param({ key: 'relay.feedMissFloorMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1_000 });

const HEADERS = Object.freeze({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
/** The one miss. */
const MISS = Object.freeze({ status: 404, type: 'text/plain; charset=utf-8', body: 'Not found' });

/**
 * Mount the `/feed/*` handler on the relay's HTTP server. Every other path falls through to the listeners already
 * there, untouched (the blob gate's way of mounting).
 *
 * @param {import('node:http').Server} httpServer
 * @param {object} o
 * @param {(node: string, a: {id: string, k: string}) => Promise<string|null>} o.serve   ask the node; the text or null
 * @param {(node: string) => boolean} o.isPresent   is that node's session live right now
 * @param {(node: string) => boolean} [o.isRefused]  did that node refuse lately (then it is not asked)
 * @param {number} [o.timeoutMs]
 * @param {number} [o.maxInFlight]
 * @param {number} [o.maxPerNode]
 * @param {number} [o.missFloorMs]
 */
export function mountFeedForward(httpServer, {
  serve, isPresent, isRefused = () => false, timeoutMs = FEED_SERVE_TIMEOUT_MS, maxInFlight = FEED_MAX_IN_FLIGHT,
  maxPerNode = FEED_MAX_PER_NODE, missFloorMs = FEED_MISS_FLOOR_MS,
} = {}) {
  if (!httpServer || typeof httpServer.listeners !== 'function') throw new Error('mountFeedForward: a node http server is required');
  if (typeof serve !== 'function' || typeof isPresent !== 'function') throw new Error('mountFeedForward: serve and isPresent are required');

  /** `${node}\n${id}` → { k, promise } — the one serve in flight for that file. */
  const inFlight = new Map();
  let total = 0;

  const bounded = (p) => new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
    Promise.resolve(p).then((v) => resolve(v), () => resolve(null)).finally(() => clearTimeout(timer));
  });

  /** node → { busy, waiting: [wake] } — the places at one node. */
  const places = new Map();
  /** A place at `node`, waited for no longer than the bound: true, or false (then no place is held). */
  function takePlace(node) {
    const at = places.get(node) ?? { busy: 0, waiting: [] };
    places.set(node, at);
    if (at.busy < maxPerNode) { at.busy += 1; return Promise.resolve(true); }
    return new Promise((resolve) => {
      const wake = () => { clearTimeout(timer); at.busy += 1; resolve(true); };
      const timer = setTimeout(() => { at.waiting.splice(at.waiting.indexOf(wake), 1); resolve(false); }, timeoutMs);
      timer.unref?.();
      at.waiting.push(wake);
    });
  }
  function leavePlace(node) {
    const at = places.get(node);
    if (!at) return;
    at.busy -= 1;
    const next = at.waiting.shift();
    if (next) next();
    else if (at.busy <= 0) places.delete(node);
  }

  async function serveOnce({ node, id, k }) {
    if (!isPresent(node) || isRefused(node)) return null;
    const key = `${node}\n${id}`;
    for (;;) {
      const cur = inFlight.get(key);
      if (!cur) break;
      if (sameKey(cur.k, k)) return cur.promise;   // the very same request: one ask, one answer
      await cur.promise;                           // another key for this file: wait, then ask for itself
    }
    // claimed before any wait, so an identical request arriving meanwhile shares this one
    const promise = (async () => {
      if (!(await takePlace(node))) return null;
      try {
        // what may have changed while it waited: the node gone, or refusing, or the relay full
        if (!isPresent(node) || isRefused(node) || total >= maxInFlight) return null;
        total += 1;
        try { const v = await bounded(serve(node, { id, k })); return typeof v === 'string' ? v : null; } finally { total -= 1; }
      } finally { leavePlace(node); }
    })();
    inFlight.set(key, { k, promise });
    try { return await promise; } finally { if (inFlight.get(key)?.promise === promise) inFlight.delete(key); }
  }

  async function handle(req, res, pathname) {
    const started = Date.now();
    const at = req.method === 'GET' ? parseFeedLinkPath(pathname) : null;
    // not a link, or a link that names no node (or not one that parses): the miss, before anything is asked
    if (!at || !at.node || !LINK_TOKEN.test(at.id) || !LINK_TOKEN.test(at.k)) return answer(res, MISS);
    let text = null;
    try { text = await serveOnce(at); } catch { text = null; }
    if (typeof text === 'string') return answer(res, { status: 200, type: 'text/calendar; charset=utf-8', body: text });
    const wait = started + missFloorMs - Date.now();
    if (wait > 0) await new Promise((r) => { const h = setTimeout(r, wait); h.unref?.(); });
    return answer(res, MISS);
  }

  const existing = httpServer.listeners('request').slice();
  httpServer.removeAllListeners('request');
  httpServer.on('request', (req, res) => {
    const pathname = String(req.url ?? '').split('?')[0];
    if (pathname === '/feed' || pathname.startsWith('/feed/')) { handle(req, res, pathname).catch(() => answer(res, MISS)); return; }
    for (const listener of existing) listener.call(httpServer, req, res);
  });
  return { inFlight: () => total };
}

/** The miss for any `/feed/*` path, as the handler answers it (for tests that compare bodies). */
export const FEED_MISS_BODY = MISS.body;

function answer(res, { status, type, body }) {
  try {
    res.writeHead(status, { 'content-type': type, ...HEADERS });
    res.end(body);
  } catch { /* the client went away */ }
}

function sameKey(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * The relay's seat at its own table: an in-process agent that asks nodes `feed.serve`.
 *
 * @param {object} o
 * @param {(to: string, envelope: object) => void} o.deliver   hand an envelope to `to`'s live socket, or drop it
 * @param {number} [o.refusedTtlMs]   how long a node that refused is not asked again
 * @param {() => number} [o.now]
 * @returns {Promise<{address: string, receive: (envelope: object) => void, serve: Function, isRefused: (node: string) => boolean, stop: () => Promise<void>}>}
 */
export async function createFeedSeat({ deliver, refusedTtlMs = FEED_REFUSED_TTL_MS, now = Date.now }) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  /** node → how many asks are waiting on it; the seat hears only from these. */
  const asking = new Map();
  /** node → the hello on its way to it: concurrent asks share one. */
  const greeting = new Map();
  /** node → until when it is not asked (it refused). Swept as it is read; bounded by the nodes that refused. */
  const refusedUntil = new Map();
  const isRefused = (node) => {
    const until = refusedUntil.get(node);
    if (until === undefined) return false;
    if (until > now()) return true;
    refusedUntil.delete(node);
    return false;
  };
  const greet = (node, ms) => {
    let p = greeting.get(node);
    if (!p) { p = agent.hello(node, ms).finally(() => greeting.delete(node)); greeting.set(node, p); }
    return p;
  };
  const transport = new SeatTransport({ address: identity.pubKey, identity, deliver });
  const agent = new Agent({ identity, transport, label: 'relay-feed' });
  agent.security.setSenderAuthorizer(({ from }) => (asking.has(from) ? allowSender('asked') : refuseSender('not-asked')));
  await agent.start();

  return {
    address: identity.pubKey,
    /** An envelope the routing table holds for the seat: taken only from a node it is asking. */
    receive(envelope) {
      if (!asking.has(envelope?._from)) return;
      queueMicrotask(() => { try { transport._receive(envelope); } catch { /* a bad envelope is a miss */ } });
    },
    isRefused,
    /** Ask `node` for the link's text: the text, or null for every kind of miss. Never retried. */
    async serve(node, { id, k }, { timeoutMs = FEED_SERVE_TIMEOUT_MS } = {}) {
      if (isRefused(node)) return null;
      asking.set(node, (asking.get(node) ?? 0) + 1);
      const deadline = Date.now() + timeoutMs;
      let stage = 'hello';
      try {
        await greet(node, Math.max(1, deadline - Date.now()));
        stage = 'ask';
        const parts = await agent.invoke(node, FEED_SERVE_OP, { id, k }, { timeout: Math.max(1, deadline - Date.now()), quiet: true });
        const r = Parts.data(parts);
        if (r?.ok === true && typeof r.ics === 'string') return r.ics;
        // a companion's miss is an answer; anything else from a node that greeted us is a refusal
        if (r?.ok !== false) refusedUntil.set(node, now() + refusedTtlMs);
        return null;
      } catch (err) {
        // the node answered the ask with a refusal (no such op, its gate denied): not asked again for a while. A
        // timeout — at the hello or the ask — is no refusal: a slow companion is not a phone.
        if (stage === 'ask' && !/timeout/i.test(String(err?.message ?? ''))) refusedUntil.set(node, now() + refusedTtlMs);
        // the node may have restarted and forgotten this seat: greet it afresh next time (not now — never retried)
        agent.security.unregisterPeer(node);
        return null;
      } finally {
        const n = (asking.get(node) ?? 1) - 1;
        if (n > 0) asking.set(node, n); else asking.delete(node);
      }
    },
    async stop() { try { await agent.stop(); } catch { /* best-effort */ } },
  };
}

/** The seat's wire: the relay's routing table, live sockets only. */
class SeatTransport extends Transport {
  #deliver;
  constructor({ address, identity, deliver }) {
    super({ address, identity });
    this.#deliver = deliver;
  }
  canReach() { return true; }
  async connect() { this.emit('connect', { address: this.address }); }
  async disconnect() { this.emit('disconnect'); }
  async _put(to, envelope) { this.#deliver(to, envelope); }
}
