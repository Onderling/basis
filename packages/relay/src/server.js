/**
 * startRelay — HTTP(S) + WebSocket relay broker.
 *
 * The relay is a simple message broker: agents register by address, and the
 * relay forwards envelopes to the correct connected client. Offline recipients
 * get up to 50 messages queued for 5 minutes.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Relay: { type: 'register', address: '<pubKey>', groupProof? }
 *   Relay  → Client: { type: 'registered' }
 *   Client → Relay: { type: 'send',  to: '<address>', envelope: { ... } [, topic: '<topic>'] }
 *   Relay  → Client: { type: 'message', envelope: { ... } }
 *   Client → Relay: { type: 'peer-list' }                          // request
 *   Relay  → Client: { type: 'peer-list', peers: ['...','...'] }    // response + broadcast
 *   Relay  → Client: { type: 'error', message: '<reason>' }
 *
 * Topic-aware offline queue (Phase 7 step 4): when the wire `send` frame
 * carries an optional `topic` field (set by `RelayTransport._put` for
 * envelopes built via `publishOneWay`), offline buffering buckets per
 * (recipient, topic) — each bucket independently capped at `queueCap`.
 * A noisy publisher on one topic can no longer evict another topic's
 * pending messages. Total per-address buffering is bounded by
 * `queueCapTotal` (default 4× `queueCap`) as a safety valve.
 *
 * Group broadcast (Phase 7 step 5):
 *   Client → Relay: { type: 'group-publish', groupId, topic?, envelope }
 *   Relay  → Members: { type: 'message', envelope }   (one per group member,
 *                                                       sender excluded)
 *   Relay  → Sender:  { type: 'group-publish-ack', groupId, delivered, queued }
 *
 * Group membership is tracked at register time from `groupProof`.  A
 * sender may only fan out to a group they are themselves a member of.
 * Offline members get queued via the same topic-aware buffer as `send`.
 *
 * Multi-recipient (E2b):
 *   Client → Relay: { type: 'multi-request', targets: [...], payload: {...},
 *                     timeoutMs?: number }
 *   Relay  → Target: { type: 'multi-deliver', id, from: '<callerPubKey>', payload }
 *   Target → Relay: { type: 'multi-response-from-target', id, response }
 *   Relay  → Client: { type: 'multi-response', id, responses: [...], partial: bool }
 *
 * Group auth (Q-E.2, locked 2026-04-28): when `acceptedGroups` is
 * configured, the first `register` message MUST include a `groupProof`
 * field — a `GroupManager`-issued proof for one of the accepted groups.
 * The relay verifies the proof's signature, expiry, and configured
 * `requiredRole` (if any) before accepting the registration.  When
 * `acceptedGroups` is unset or empty, the relay accepts every client
 * (legacy behavior, fully backward compatible).
 *
 * Phase 2 (Stoop V1 — 2026-05-05):
 *
 *   - `register` may additionally carry a `rotationProof` (built by
 *     `core.KeyRotation.buildProof`) when the connecting `address` is
 *     not the same as `groupProof.memberPubKey`.  The relay accepts
 *     the registration when the rotationProof signature is valid, links
 *     the proof's old pubKey to the connecting key, and is within its
 *     grace period.  Without a rotationProof, mismatched address +
 *     proof now fails with `BINDING_MISMATCH` (closing a legacy
 *     spoofing loophole; only callers that always-passed-anyway are
 *     affected).
 *
 *   - Each accepted-group entry may carry `revokedMembers: ['<pubKey>']`
 *     for static revocation; matching `groupProof.memberPubKey`s are
 *     rejected with `MEMBER_REVOKED`.
 *
 *   - Each accepted-group entry may carry
 *     `quotas: { msgsPerDay?, maxConnections? }`:
 *       * `maxConnections` checked at register time; over-cap →
 *         `OVER_QUOTA_CONNECTIONS` and the socket is closed.
 *       * `msgsPerDay` counts `send` + `group-publish` originated by
 *         that group's members; over-cap → `OVER_QUOTA_MSGS_PER_DAY`
 *         on the offending frame (socket stays open). Counter rolls
 *         over at 00:00 UTC.
 *
 * When `tlsCert` and `tlsKey` are supplied, the server listens on HTTPS/WSS.
 * Without them, HTTP/WS. Usage:
 *
 *   const { stop } = await startRelay({ port: 8787 });              // ws://
 *   const { stop } = await startRelay({ port: 443,
 *     tlsCert: readFileSync('cert.pem'),
 *     tlsKey:  readFileSync('key.pem') });                          // wss://
 *
 * See EXTRACTION-PLAN.md §7 Group S.
 */
import { createServer as createHttpServer }  from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { readFile, stat }                    from 'node:fs/promises';
import { extname, join, resolve }            from 'node:path';
import { networkInterfaces }                 from 'node:os';
import { WebSocketServer }                   from 'ws';
import { MultiRecipientQueue }               from './MultiRecipientQueue.js';
import { ForwardQueue }                       from './ForwardQueue.js';
import { GroupAuthVerifier }                 from './GroupAuthVerifier.js';
import { PushTokenRegistry }                 from './push/PushTokenRegistry.js';
import { envelopeSuppressesWake }            from './push/wakePayload.js';
import { mountBlobGate }                     from './blobGateMount.js';
import { logHop }                            from './verbose.js';

const DEFAULT_PORT             = 8787;
const DEFAULT_QUEUE_TTL        = 5 * 60_000;  // 5 min
const DEFAULT_QUEUE_CAP        = 50;
// Topic-aware queueing (Phase 7 step 4) caps each (addr, topic) bucket at
// `queueCap`; the per-address global cap is a safety valve so a publisher
// flooding many distinct topics can't memory-DoS the relay. Default is
// 4× queueCap, so up to 4 saturated topics fit before global FIFO eviction
// kicks in.
const DEFAULT_QUEUE_CAP_RATIO  = 4;
const DEFAULT_PUSH_THROTTLE_MS = 30_000;     // do not push more than once / 30s / address

// Default per-connection message rate limit (J-security flood defense).
// A token-bucket over the data-plane frames (`send`, `group-publish`) so a
// single connection cannot flood a LIVE peer with unbounded messages in OPEN
// mode (the group-quota path only throttles grouped deployments; the offline
// queue caps only bound buffering to OFFLINE peers). Chosen to sit far above
// normal interactive chat/kring traffic (a human sends a handful of messages
// per second; a kring fan-out is ONE `group-publish` frame) while capping a
// flood: `burst` messages may go through instantly, then `perSec` sustained.
// A 200-message instantaneous blast delivers ~`burst` then gets `OVER_RATE`.
const DEFAULT_MSG_RATE_PER_SEC = 30;
const DEFAULT_MSG_RATE_BURST   = 60;

/**
 * Minimal O(1) token bucket. `take()` returns true and consumes one token
 * when available, else false (no token consumed on reject). Refills
 * continuously at `perSec`, capped at `burst`. Per-connection: one bucket
 * per socket, so bursts are naturally absorbed and only a sustained flood
 * from a single connection is throttled.
 */
function createTokenBucket({ perSec, burst }) {
  let tokens   = burst;
  let lastFill = Date.now();
  return {
    take() {
      const now    = Date.now();
      const refill = ((now - lastFill) / 1000) * perSec;
      if (refill > 0) { tokens = Math.min(burst, tokens + refill); lastFill = now; }
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    },
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
};

/**
 * Start a relay server.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.port=8787]
 * @param {string}   [opts.host='0.0.0.0']
 * @param {string|Buffer} [opts.tlsCert]     PEM-encoded certificate (enables HTTPS)
 * @param {string|Buffer} [opts.tlsKey]      PEM-encoded private key
 * @param {string}   [opts.serveStaticDir]   Directory to serve over HTTP (optional)
 * @param {string}   [opts.indexFile]        Default file when path is '/' (default 'index.html')
 * @param {number}   [opts.queueTtlMs]       How long to buffer messages for offline peers
 * @param {number}   [opts.queueCap=50]      Max buffered messages per (offline peer, topic) bucket. Non-publish sends share a single legacy bucket (topic=null) capped at the same value.
 * @param {number}   [opts.queueCapTotal]    Global safety-valve cap on total buffered messages per offline peer (default `queueCap * 4`). Protects against publishers flooding many distinct topics each just under the per-bucket cap.
 * @param {boolean}  [opts.log=false]        Log per-message events to stdout
 * @param {object}   [opts.multiRecipientQueueOpts]  Forwarded to `MultiRecipientQueue`
 *                                                   (e.g. `{ store, defaultTimeoutMs }`).
 *                                                   Defaults to a fresh in-memory queue.
 * @param {MultiRecipientQueue} [opts.multiRecipientQueue]  Inject a pre-built queue (tests).
 * @param {Array<{ groupId: string, adminPubKey: string, requiredRole?: string }>} [opts.acceptedGroups]
 *   Group-membership gating (Q-E.2).  If provided + non-empty, clients
 *   must present a valid `GroupManager`-issued proof in the `register`
 *   message for one of these groups.  If unset/empty, the relay is open.
 * @param {Record<string, number>} [opts.roleRanks]
 *   Optional role-rank override for `requiredRole` checks (e.g. when an
 *   app registers custom roles via `Roles.registerCustomRole`).  Merged
 *   on top of the standard 5-role rank table.
 * @param {{ perSec?: number, burst?: number } | false} [opts.messageRateLimit]
 *   Default per-connection message rate limit (J-security flood defense),
 *   applied to `send` + `group-publish` frames in EVERY mode (open + grouped;
 *   it complements the per-group day quotas, it does not replace them). A
 *   token-bucket per connection: up to `burst` messages instantly, then
 *   `perSec` sustained. Over-rate frames are rejected with an `OVER_RATE`
 *   error frame (the socket stays open — a transient burst is absorbed by the
 *   bucket, not by tearing down the connection). Defaults to
 *   `{ perSec: 30, burst: 60 }`. Pass `false` to disable entirely.
 * @param {object} [opts.blobGate]
 *   (media-infra): mount the blob-gateway HTTP edge on this relay
 *   `{ verifyToken, bucket, acl?, ttl?, route?, uploaders? }`, forwarded to
 *   `mountBlobGate` (see `./blobGateMount.js` for the full contract + R2
 *   env wiring).  When absent, NOTHING changes: no routes are added and
 *   the HTTP handler behaves byte-identically to a relay without this
 *   feature.
 * @returns {Promise<{
 *   httpServer: import('node:http').Server | import('node:https').Server,
 *   wss: WebSocketServer,
 *   port: number,
 *   tls: boolean,
 *   stop: () => Promise<void>,
 * }>}
 */
export async function startRelay(opts = {}) {
  const {
    port            = DEFAULT_PORT,
    host            = '0.0.0.0',
    tlsCert,
    tlsKey,
    serveStaticDir,
    indexFile       = 'index.html',
    queueTtlMs                = DEFAULT_QUEUE_TTL,
    queueCap                  = DEFAULT_QUEUE_CAP,
    queueCapTotal,                                   // global per-addr cap (safety valve)
    log                       = false,
    multiRecipientQueue       = undefined,
    multiRecipientQueueOpts   = undefined,
    acceptedGroups,
    roleRanks,
    // E2c: push wake-up.  When `pushSender` is null/undefined, the relay
    // ignores `register-push-token` envelopes and never attempts wake — fully
    // backward compatible with existing tests and deployments.
    pushSender                = null,
    pushTokenRegistry         = undefined,
    pushThrottleMs            = DEFAULT_PUSH_THROTTLE_MS,
    // J-security: default per-connection message rate limit. `false` disables.
    messageRateLimit          = undefined,
    // (media-infra): optional blob-gate edge. When `blobGate` is
    // null/undefined, the relay adds no routes and behaves byte-identically —
    // fully backward compatible with existing tests and deployments.
    blobGate                  = null,
  } = opts;

  const effectiveQueueCapTotal = queueCapTotal ?? (queueCap * DEFAULT_QUEUE_CAP_RATIO);

  // J-security: per-connection message rate limit config. `false` disables;
  // otherwise merge partial overrides on top of the defaults.
  const rateLimitCfg = messageRateLimit === false
    ? null
    : {
        perSec: messageRateLimit?.perSec ?? DEFAULT_MSG_RATE_PER_SEC,
        burst:  messageRateLimit?.burst  ?? DEFAULT_MSG_RATE_BURST,
      };

  // Multi-recipient (E2b) — additive.  Defaults to a fresh in-memory queue.
  const mrQueue = multiRecipientQueue
    ?? new MultiRecipientQueue(multiRecipientQueueOpts ?? {});

  // E2c: token registry exists whenever `pushSender` is configured; otherwise
  // we still allow callers to inject one for advanced setups.
  // G15 (2026-07-27): if the caller wired a durable store on the registry, rehydrate it BEFORE serving —
  // otherwise the relay comes back up having forgotten every sleeping device it is supposed to wake, and
  // nothing anywhere reports it. A store failure must not stop the relay booting: online peers are still
  // served over their sockets; only wakes degrade, so it is logged and startup continues.
  const tokenRegistry = pushTokenRegistry
    ?? (pushSender ? new PushTokenRegistry() : null);
  if (tokenRegistry && typeof tokenRegistry.hydrate === 'function') {
    try {
      const restored = await tokenRegistry.hydrate();
      if (restored > 0) console.info(`[relay] restored ${restored} push-token registration(s)`);
    } catch (err) {
      console.warn('[relay] push-token store unavailable — sleeping devices cannot be woken until it '
        + `recovers: ${err?.message ?? err}`);
    }
  }

  // Q-E.2: optional group-membership gate.  Open mode (no acceptedGroups)
  // preserves the legacy behavior — every existing relay test still passes.
  const groupAuth = new GroupAuthVerifier({
    acceptedGroups: acceptedGroups ?? [],
    roleRanks,
  });

  const hasTls = Boolean(tlsCert && tlsKey);
  if ((tlsCert && !tlsKey) || (!tlsCert && tlsKey)) {
    throw new Error('startRelay: tlsCert and tlsKey must both be provided for TLS');
  }

  // ── HTTP(S) handler ────────────────────────────────────────────────────────
  const handler = async (req, res) => {
    if (!serveStaticDir) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('@onderling/relay — WebSocket endpoint only');
      return;
    }

    let pathname = req.url.split('?')[0];
    if (pathname === '/' || pathname === '') pathname = '/' + indexFile;

    const rootAbs  = resolve(serveStaticDir);
    const filePath = resolve(join(rootAbs, pathname));

    // Security: prevent path traversal outside the static root.
    if (!filePath.startsWith(rootAbs)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }

    try {
      const s = await stat(filePath);
      if (s.isDirectory()) { res.writeHead(404); res.end('Not a file'); return; }
      const data = await readFile(filePath);
      const mime = MIME[extname(filePath)] ?? 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type':                mime,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control':               'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${pathname}`);
    }
  };

  const httpServer = hasTls
    ? createHttpsServer({ cert: tlsCert, key: tlsKey }, handler)
    : createHttpServer(handler);

  // (media-infra): mount the blob-gate edge ONLY when configured. The
  // mount wraps the request listeners additively — non-mount paths fall
  // through to `handler` untouched; without `blobGate` no wrap happens at all.
  const blobGateMount = blobGate ? mountBlobGate(httpServer, blobGate) : null;

  // ── WebSocket relay ────────────────────────────────────────────────────────
  const wss = new WebSocketServer({ server: httpServer });

  /** address → WebSocket */
  const clients = new Map();
  /**
   * Hold-and-forward for offline recipients — the single relay forward owner
   * shared with WsServerTransport. This broker's shape: topic-aware buckets
   * capped at `queueCap`, a global per-address safety valve, a push-wake hook,
   * and periodic (timer-driven) eviction rather than lazy-on-write.
   */
  const forwardQueue = new ForwardQueue({
    ttlMs:         queueTtlMs,
    topicAware:    true,
    queueCap,
    queueCapTotal: effectiveQueueCapTotal,
    evictOnWrite:  false,
    onWake:        (to) => tryWakePush(to),
  });
  /** groupId → Set<address>  — populated at register time when groupProof is accepted (Phase 7 step 5). */
  const clientsByGroup = new Map();
  /** address → groupId  — reverse lookup used by Phase 2A msgsPerDay enforcement. */
  const groupByAddress = new Map();
  /**
   * Phase 2A — per-group msgsPerDay counters.
   *   groupId → { day: <YYYY-MM-DD UTC>, count: number }
   * Day rolls over at 00:00 UTC; counters reset on roll-over.  Pure
   * in-memory; persistence across restarts is not promised (matches
   * the existing relay state — none of clients / queue / clientsByGroup
   * survives a restart either).
   */
  const groupMsgsToday = new Map();
  const dayKey = () => new Date().toISOString().slice(0, 10);
  /**
   * Increment the per-day counter for a sender's group.  Returns
   * `{over, count, cap}`; the caller checks `over` and decides
   * whether to reject.
   */
  const tickGroupMsg = (groupId, cap) => {
    const today = dayKey();
    const rec = groupMsgsToday.get(groupId);
    if (!rec || rec.day !== today) {
      groupMsgsToday.set(groupId, { day: today, count: 1 });
      return { over: cap != null && 1 > cap, count: 1, cap };
    }
    rec.count += 1;
    return { over: cap != null && rec.count > cap, count: rec.count, cap };
  };

  const logLine = (line) => { if (log) console.log(line); };

  /**
   * Fire a wake-up push for an offline recipient.  Best-effort and
   * fire-and-forget: errors are swallowed so the relay's hot path is
   * never blocked by a slow push provider.  Throttled per recipient
   * via `pushThrottleMs` so a burst of `send`s doesn't burst pushes.
   */
  /**
   * Deliver to a connected recipient, otherwise enqueue with topic-aware
   * bucketing (Phase 7 step 4). Returns `'delivered'` or `'queued'` so
   * `group-publish` (step 5) can summarise the fan-out outcome. Delegates
   * to the shared ForwardQueue (which fires `onWake` → `tryWakePush` on a
   * buffered delivery).
   */
  const deliverOrEnqueue = (to, envelope, topic) =>
    forwardQueue.deliverOrEnqueue(to, envelope, {
      socket: clients.get(to) ?? null,
      topic,
      // Per-message wake-gate: an envelope stamped `noWake` (routine governance
      // votes/resolves, reports — the sender consulted `governanceWakeHint`) is
      // still hold-forwarded, but must NOT fire a push wake. Only a decision
      // OPENING wakes an offline device. Absent flag ⇒ wake exactly as before.
      wake:   !envelopeSuppressesWake(envelope),
    });

  const tryWakePush = (address) => {
    if (!pushSender || !tokenRegistry) return;
    const rec = tokenRegistry.get(address);
    if (!rec) return;
    const now = Date.now();
    if (now - rec.lastPushedAt < pushThrottleMs) return;
    tokenRegistry.markPushed(address, now);
    // Wake payload is intentionally minimal — the device fetches details on
    // wake. Apps that want richer payloads can compose their own wake hint.
    Promise.resolve(pushSender.send(rec.token, { wake: true, hint: 'message-pending' }, {
      platform: rec.platform,
    }))
      .then((res) => {
        if (!res?.ok) logLine(`[relay] push-failed   ${shortId(address)}  ${res?.error ?? 'unknown'}`);
      })
      .catch((err) => logLine(`[relay] push-threw   ${shortId(address)}  ${err?.message ?? err}`));
  };

  wss.on('connection', (socket) => {
    // G13 — ONE socket may own SEVERAL addresses: a device presents a different address per circle, and
    // (decisions.md 2026-07-27) since the relay can correlate them anyway via the shared push token, one
    // connection carrying N addresses is both the cheap and the correct shape. `registeredAddress` stays as
    // the socket's PRIMARY identity — the first one registered — because sender-side concerns (rate limits,
    // group-publish membership, multi-recipient responses, logs) are about the DEVICE, not the circle it is
    // speaking in. `registeredAddresses` is the routing set.
    let registeredAddress = null;
    const registeredAddresses = new Set();
    /** The push token this socket registered, if any — reapplied to every address it later registers. */
    let socketPushToken = null;
    // J-security: per-connection message rate limit (flood defense). One
    // bucket per socket — absorbs bursts, throttles a sustained flood. Null
    // when disabled via `messageRateLimit: false`.
    const msgBucket = rateLimitCfg ? createTokenBucket(rateLimitCfg) : null;

    socket.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // ── register ────────────────────────────────────────────────────────────
      if (msg.type === 'register') {
        const { address, groupProof, rotationProof } = msg;
        if (!address) {
          socket.send(JSON.stringify({ type: 'error', message: 'Missing address' }));
          return;
        }

        // Q-E.2 + Phase 2 (Stoop V1, 2026-05-05): gate on group
        // membership when configured.  In open mode (no acceptedGroups),
        // both `verify` and `verifyBound` always return ok=true.
        // `verifyBound` ALSO enforces proof.memberPubKey === address
        // unless a valid `rotationProof` (from `core.KeyRotation`) links
        // the proof's old pubKey to the connecting key — closing the
        // legacy spoofing loophole.  Open-mode deployments and tests
        // are unaffected (verifyBound short-circuits in open mode).
        const auth = groupAuth.verifyBound({
          proof: groupProof,
          connectingPubKey: address,
          rotationProof,
        });
        if (!auth.ok) {
          socket.send(JSON.stringify({ type: 'error', message: auth.reason }));
          logLine(`[relay] auth-rejected ${shortId(address)} (${auth.reason})`);
          try { socket.close(); } catch {}
          return;
        }

        // Phase 2A — per-group maxConnections quota.  Reject before we
        // mutate clients / clientsByGroup so over-cap connections never
        // leave residual state.
        const cfg = auth.group;
        const maxConns = cfg?.quotas?.maxConnections;
        // A REPEAT register on the same socket (a second circle address) is not a new connection, so it
        // must not consume connection quota — otherwise a member of N circles would exhaust a cap meant to
        // count devices.
        const alreadyOwned = registeredAddresses.has(address);
        if (typeof maxConns === 'number' && cfg?.groupId && !alreadyOwned) {
          const currentSize = clientsByGroup.get(cfg.groupId)?.size ?? 0;
          if (currentSize >= maxConns) {
            socket.send(JSON.stringify({ type: 'error', message: 'OVER_QUOTA_CONNECTIONS' }));
            logLine(`[relay] quota-rejected ${shortId(address)} (group=${cfg.groupId} max=${maxConns})`);
            try { socket.close(); } catch {}
            return;
          }
        }

        if (registeredAddress === null) registeredAddress = address;   // first one is the primary
        registeredAddresses.add(address);
        clients.set(address, socket);

        // Decision 2(a): a push token registered on this socket covers EVERY address it owns — including
        // ones registered later. Registering per-address would give N chances to forget one, and a
        // forgotten address is a circle whose offline members silently stop being woken (the G15 failure).
        if (tokenRegistry && socketPushToken) {
          tokenRegistry.register(address, socketPushToken);
        }

        // Phase 7 step 5: track group-membership for `group-publish` fan-out.
        // `auth.group` is null in open mode; otherwise it's the matched
        // accepted-group config entry containing `groupId`.
        if (auth.group?.groupId) {
          if (!clientsByGroup.has(auth.group.groupId)) {
            clientsByGroup.set(auth.group.groupId, new Set());
          }
          clientsByGroup.get(auth.group.groupId).add(address);
          groupByAddress.set(address, auth.group.groupId);
        }

        socket.send(JSON.stringify({ type: 'registered' }));
        logLine(`[relay] registered   ${shortId(address)}`);

        // Drain any queued messages for THIS address. Decision 3: draining per REGISTRATION rather than
        // per socket means there is no assumption about which address registers first, and no window where
        // a drain runs before the address it belongs to exists.
        // `onEach` preserves the verbose hop log — the on-the-wire record even when the recipient was
        // offline at send time. (Eviction is timer-driven, so no evictFirst.)
        forwardQueue.drain(address, socket, {
          onEach: (envelope) => logHop({ kind: 'send-queued', from: '?', to: address, envelope }),
        });

        _broadcastPeerList(clients);
        return;
      }

      // ── send ────────────────────────────────────────────────────────────────
      if (msg.type === 'send') {
        const { to, envelope, topic } = msg;
        if (!to || !envelope) return;

        // J-security — per-connection rate limit. Checked BEFORE the group
        // day-quota so a flood is stopped cheaply (O(1)) without burning the
        // sender's daily allowance. Socket stays open (transient burst is
        // absorbed by the bucket); only over-rate frames get OVER_RATE.
        if (msgBucket && !msgBucket.take()) {
          socket.send(JSON.stringify({ type: 'error', message: 'OVER_RATE' }));
          logLine(`[relay] rate-limited ${shortId(registeredAddress)} send`);
          return;
        }

        // Phase 2A — enforce per-group msgsPerDay quota when the sender
        // is registered to a group with a quota.  Open-mode senders and
        // group-less registrations are unaffected.
        const senderGroup = registeredAddress ? groupByAddress.get(registeredAddress) : null;
        if (senderGroup) {
          const cfg = groupAuth.acceptedGroups.find(g => g.groupId === senderGroup);
          const cap = cfg?.quotas?.msgsPerDay;
          if (cap != null) {
            const tick = tickGroupMsg(senderGroup, cap);
            if (tick.over) {
              socket.send(JSON.stringify({ type: 'error', message: 'OVER_QUOTA_MSGS_PER_DAY' }));
              logLine(`[relay] quota-rejected ${shortId(registeredAddress)} send (group=${senderGroup} cap=${cap})`);
              return;
            }
          }
        }

        const online = clients.get(to);
        if (online && online.readyState === 1) {
          logLine(`[relay] ${shortId(registeredAddress)} → ${shortId(to)}  _p=${envelope._p ?? '?'}${topic ? ` topic=${topic}` : ''}`);
          // Q-Smoke.4 (locked 2026-04-29): per-hop verbose log + plaintext-leak
          // detector for the S9 sealed-forward smoke check.  No-op unless
          // RELAY_VERBOSE=1 is set.
          logHop({ kind: 'send', from: registeredAddress, to, envelope });
        }
        deliverOrEnqueue(to, envelope, topic);
        return;
      }

      // ── group-publish ───────────────────────────────────────────────────────
      // Phase 7 step 5: fan out a single envelope to all currently-known
      // group members in one client→relay frame. Authentication: the
      // sender must have registered with a `groupProof` for this groupId
      // (membership is tracked at register time). Offline members get
      // queued via the same topic-aware buffer as `send`. The relay's
      // `clients` map only gives "currently connected"; pod-config rosters
      // (L1h `MemberMap.fromPodConfig`) are the authoritative roster.
      if (msg.type === 'group-publish') {
        if (!registeredAddress) {
          socket.send(JSON.stringify({ type: 'error', message: 'group-publish requires register first' }));
          return;
        }
        const { groupId, topic, envelope } = msg;
        if (!groupId || !envelope) {
          socket.send(JSON.stringify({ type: 'error', message: 'group-publish: groupId + envelope required' }));
          return;
        }

        // J-security — per-connection rate limit (one group-publish frame is
        // one token, regardless of fan-out). Same bucket as `send` so a peer
        // can't sidestep the limit by switching frame types.
        if (msgBucket && !msgBucket.take()) {
          socket.send(JSON.stringify({ type: 'error', message: 'OVER_RATE' }));
          logLine(`[relay] rate-limited ${shortId(registeredAddress)} group-publish`);
          return;
        }

        const memberSet = clientsByGroup.get(groupId);
        if (!memberSet || !memberSet.has(registeredAddress)) {
          socket.send(JSON.stringify({ type: 'error', message: 'group-publish: not a member of this group' }));
          return;
        }

        // Phase 2A — enforce per-group msgsPerDay on group-publish too.
        // A single group-publish counts as ONE message regardless of fan-out;
        // the cap is per-sender-publishes-per-group, not per-fanout-hop.
        {
          const cfg = groupAuth.acceptedGroups.find(g => g.groupId === groupId);
          const cap = cfg?.quotas?.msgsPerDay;
          if (cap != null) {
            const tick = tickGroupMsg(groupId, cap);
            if (tick.over) {
              socket.send(JSON.stringify({ type: 'error', message: 'OVER_QUOTA_MSGS_PER_DAY' }));
              logLine(`[relay] quota-rejected ${shortId(registeredAddress)} group-publish (group=${groupId} cap=${cap})`);
              return;
            }
          }
        }

        let delivered = 0;
        let queued    = 0;
        for (const member of memberSet) {
          if (member === registeredAddress) continue;       // sender excluded
          logHop({ kind: 'group-publish', from: registeredAddress, to: member, envelope });
          const outcome = deliverOrEnqueue(member, envelope, topic ?? null);
          if (outcome === 'delivered') delivered += 1;
          else                          queued    += 1;
        }
        logLine(`[relay] group-publish ${shortId(registeredAddress)} → ${groupId}  delivered=${delivered}  queued=${queued}${topic ? ` topic=${topic}` : ''}`);
        socket.send(JSON.stringify({ type: 'group-publish-ack', groupId, delivered, queued }));
        return;
      }

      // ── push-token register / unregister (E2c) ──────────────────────────────
      if (msg.type === 'register-push-token') {
        if (!registeredAddress) {
          socket.send(JSON.stringify({
            type:    'error',
            message: 'register-push-token requires register first',
          }));
          return;
        }
        if (!tokenRegistry) {
          socket.send(JSON.stringify({
            type:    'error',
            message: 'push not configured on this relay',
          }));
          return;
        }
        const { token, platform } = msg;
        if (!token || typeof token !== 'string') {
          socket.send(JSON.stringify({
            type:    'error',
            message: 'register-push-token: token required',
          }));
          return;
        }
        try {
          // Decision 2(a): cover EVERY address this socket owns, not just the primary. A device in three
          // circles has three addresses and one token; a wake for any of them must reach this device.
          socketPushToken = { token, platform };
          for (const addr of registeredAddresses) tokenRegistry.register(addr, socketPushToken);
        } catch (err) {
          socket.send(JSON.stringify({ type: 'error', message: err?.message ?? 'register-push-token failed' }));
          return;
        }
        socket.send(JSON.stringify({ type: 'push-token-registered' }));
        logLine(`[relay] push-tok-reg   ${shortId(registeredAddress)} (${platform ?? 'unknown'})`);
        return;
      }

      if (msg.type === 'unregister-push-token') {
        if (!registeredAddress || !tokenRegistry) return;
        // Symmetric with register: turning notifications off turns them off for every circle.
        socketPushToken = null;
        for (const addr of registeredAddresses) tokenRegistry.unregister(addr);
        socket.send(JSON.stringify({ type: 'push-token-unregistered' }));
        logLine(`[relay] push-tok-unreg ${shortId(registeredAddress)}`);
        return;
      }

      // ── peer-list request ───────────────────────────────────────────────────
      if (msg.type === 'peer-list') {
        socket.send(JSON.stringify({
          type:  'peer-list',
          peers: [...clients.keys()],
        }));
        return;
      }

      // ── multi-recipient request (E2b) ───────────────────────────────────────
      // Caller fans out a payload to N targets; relay aggregates fan-in
      // responses (or partial set on timeout) and replies to the caller.
      if (msg.type === 'multi-request') {
        if (!registeredAddress) {
          socket.send(JSON.stringify({ type: 'error', message: 'multi-request requires register first' }));
          return;
        }
        const { targets, payload, timeoutMs } = msg;
        if (!Array.isArray(targets)) {
          socket.send(JSON.stringify({ type: 'error', message: 'multi-request: targets must be an array' }));
          return;
        }

        // Capture caller socket up-front; resolve sends back to whoever asked.
        const callerSocket = socket;
        const callerAddress = registeredAddress;

        // Dispatch — deliver to a single connected target (drops if offline).
        // Offline-target wake-hint goes through `tryWakePush` (E2c) when
        // configured.  `ctx.id` is supplied by the queue so we can embed
        // it in the wire frame for fan-in correlation.
        const dispatchWithId = (target, p, ctx) => {
          const sock = clients.get(target);
          if (!sock || sock.readyState !== 1) {
            // Push-wake hint when target is offline; the response simply
            // never arrives within the timeout (mrQueue handles partial).
            tryWakePush(target);
            return;
          }
          try {
            // Verbose hop log (no-op unless RELAY_VERBOSE=1).  We log per
            // delivered target so the leak detector covers fan-out paths.
            logHop({ kind: 'multi-deliver', from: callerAddress, to: target, payload: p });
            sock.send(JSON.stringify({
              type:    'multi-deliver',
              id:      ctx?.id,
              from:    callerAddress,
              payload: p,
            }));
          } catch { /* socket may have raced a close */ }
        };

        mrQueue.fanOut({
          callerPubKey: callerAddress,
          targets,
          payload,
          timeoutMs,
          dispatch: dispatchWithId,
        }).then((result) => {
          if (callerSocket.readyState !== 1) return;
          try {
            callerSocket.send(JSON.stringify({
              type:      'multi-response',
              id:        result.id,
              responses: result.responses,
              partial:   result.partial,
            }));
          } catch { /* caller may have disconnected */ }
        }).catch((err) => {
          if (callerSocket.readyState !== 1) return;
          try {
            callerSocket.send(JSON.stringify({
              type:    'error',
              message: `multi-request failed: ${err?.message ?? String(err)}`,
            }));
          } catch {}
        });
        return;
      }

      // ── multi-recipient fan-in response from a target ───────────────────────
      if (msg.type === 'multi-response-from-target') {
        const { id, response } = msg;
        if (!id || !registeredAddress) return;
        // Best-effort: addResponse returns null for unknown/closed ids.
        mrQueue.addResponse(id, registeredAddress, response).catch(() => {});
        return;
      }
    });

    socket.on('close', () => {
      if (registeredAddress) {
        // Every address this socket owned goes with it — leaving one behind would route to a dead socket.
        for (const addr of registeredAddresses) clients.delete(addr);
        // Drop from any group-membership sets (Phase 7 step 5).
        for (const [gid, set] of clientsByGroup) {
          for (const addr of registeredAddresses) set.delete(addr);
          if (set.size === 0) clientsByGroup.delete(gid);
        }
        // Phase 2A — also drop the reverse lookup so maxConnections
        // accounting + per-day-msg gating don't leak stale slots.
        for (const addr of registeredAddresses) groupByAddress.delete(addr);
        registeredAddresses.clear();
        logLine(`[relay] disconnected ${shortId(registeredAddress)}`);
        _broadcastPeerList(clients);
      }
    });

    socket.on('error', () => {});
  });

  // ── Evict stale queued messages periodically ───────────────────────────────
  const evictTimer = setInterval(() => {
    forwardQueue.evictExpired();
  }, 60_000);
  evictTimer.unref();

  // ── Listen ─────────────────────────────────────────────────────────────────
  await new Promise((res, rej) => {
    httpServer.once('error', rej);
    httpServer.listen(port, host, () => {
      httpServer.removeListener('error', rej);
      res();
    });
  });

  const boundPort = httpServer.address()?.port ?? port;

  async function stop() {
    clearInterval(evictTimer);
    for (const [, s] of clients) { try { s.close(); } catch {} }
    clients.clear();
    await new Promise(r => wss.close(() => r()));
    await new Promise(r => httpServer.close(() => r()));
    try { await mrQueue.close(); } catch {}
  }

  return {
    httpServer, wss, port: boundPort, tls: hasTls, stop, multiRecipientQueue: mrQueue,
    // Only present when `blobGate` was configured — the no-blobGate return
    // shape stays exactly as before.
    ...(blobGateMount ? { blobGate: blobGateMount } : {}),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _broadcastPeerList(clients) {
  const list = JSON.stringify({ type: 'peer-list', peers: [...clients.keys()] });
  for (const [, sock] of clients) {
    try { if (sock.readyState === 1) sock.send(list); } catch {}
  }
}

function shortId(id) {
  return id ? String(id).slice(0, 12) + '…' : '?';
}

/** Best-effort LAN IP for friendly CLI output. */
export function getLanIp() {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}
