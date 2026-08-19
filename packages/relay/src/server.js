/**
 * startRelay — HTTP(S) + WebSocket relay broker.
 *
 * The relay is a simple message broker: agents register by address, and the
 * relay forwards envelopes to the correct connected client. Offline recipients
 * get up to 50 messages queued for 5 minutes.
 *
 * WHAT THIS RELAY KNOWS (narrowed 2026-07-31, `plans/DESIGN-boundary-authentication.md` §2):
 *
 *   > it knows which **addresses** exist and who controls them —
 *   > never which **circles** exist and who belongs to them.
 *
 * Routing integrity is legitimately the relay's job: it owns the routing table (`clients`), so keeping
 * that table honest is its business and nobody else's. Membership is not: a circle can ride NKN, or be
 * pod-backed with no relay in the path at all, so a membership gate here is a speed bump you bypass by
 * changing transport — a filter wearing a gate's clothes (`docs/conventions/enforceability.md`).
 * Membership binds where it can actually bind: the seal and the circle roster.
 *
 * Consequently the relay has NO per-group resource accounting. The per-group connection quota
 * (`quotas.maxConnections`) was removed on 2026-07-31: it counted registrations by an *unproven* claim,
 * it required the relay to hold a circle→members map to do it, and it was inert in every deployment we
 * run (it only ever counted grouped registrations, and no client presents a group proof). What replaced
 * it is per-CONNECTION and circle-blind — `maxAddressesPerConnection` below, alongside the existing
 * per-connection message rate limit.
 *
 * `acceptedGroups` / `GroupAuthVerifier` survive, **demoted from a security mechanism to operator
 * policy** — *"my relay serves these circles"* — a resource/cost decision nothing in the security model
 * depends on.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Relay: { type: 'register', address: '<pubKey>', groupProof? }
 *   Relay  → Client: { type: 'challenge', address, nonce }         // ALWAYS — see below
 *   Client → Relay: { type: 'register-proof', address, nonce, proof }
 *   Relay  → Client: { type: 'registered', address }
 *   Client → Relay: { type: 'send',  to: '<address>', envelope: { ... } [, topic: '<topic>'] }
 *   Relay  → Client: { type: 'message', envelope: { ... } }
 *   Client → Relay: { type: 'peer-list' }                          // request
 *   Relay  → Client: { type: 'peer-list', peers: ['...','...'] }    // response + broadcast
 *   Relay  → Client: { type: 'error', message: '<reason>' }
 *
 * PROOF OF POSSESSION ON REGISTER (2026-07-31, DESIGN-boundary-authentication §7 — Decision 3):
 *
 *   > you may register an address only if you can prove you hold its key.
 *
 * Registration is CHALLENGE-FIRST and has no unproven path. `register` never registers anything —
 * it asks; the relay answers with a fresh single-use nonce; the client signs
 * `addressPossessionMessage(address, nonce)` with the key behind the address; the relay verifies
 * against **the address itself**, because a per-circle address IS a public key
 * (`deriveCircleAddress` → `AgentIdentity.pubKeyFromSeed`). Only then does `clients.set` happen.
 * Nothing is minted, stored, distributed, renewed or revoked, and the relay still learns no circle.
 *
 * Each address is challenged SEPARATELY, including the several a device registers on one socket: a
 * device holds a DIFFERENT key per circle, so proving one says nothing about another. One proof per
 * address is the only honest count.
 *
 * ⚠ THIS BREAKS UN-UPGRADED CLIENTS AND RELAYS, deliberately and both ways. A client that only
 * sends `{type:'register', address}` never gets registered here; and a compliant client refuses a
 * relay that answers `registered` without challenging (`RelayTransport`), so an un-upgraded relay
 * serves nobody rather than serving them badly. There is no partial mode, because a partial mode IS
 * the invisible downgrade this exists to remove. Permitted inside the no-backcompat licence, which
 * runs to 2026-08-31 (`docs/conventions/naming-and-compatibility.md`); after that date the same
 * change would need a negotiated capability and a migration window.
 *
 * Sender binding (2026-07-31): a data-plane frame (`send`) whose
 * `envelope._from` is an address this socket has not registered is refused with
 * `SENDER_NOT_REGISTERED` and not forwarded. The socket stays open — one socket owns many
 * addresses. It asks ONE rule — `senderVerdict` from `@onderling/core`, the same
 * one the NKN transports ask with their own `authenticatedSender` port. See
 * `refuseUnboundSender` below for the full reasoning, including what this deliberately does
 * NOT protect against.
 *
 * Topic-aware offline queue (Phase 7 step 4): when the wire `send` frame
 * carries an optional `topic` field (set by `RelayTransport._put` for
 * envelopes built via `publishOneWay`), offline buffering buckets per
 * (recipient, topic) — each bucket independently capped at `queueCap`.
 * A noisy publisher on one topic can no longer evict another topic's
 * pending messages. Total per-address buffering is bounded by
 * `queueCapTotal` (default 4× `queueCap`) as a safety valve.
 *
 * Group broadcast — REMOVED 2026-07-31. The relay used to carry a
 * `{ type: 'group-publish', groupId, topic?, envelope }` frame that fanned one
 * envelope out to every connected member of a group (Phase 7 step 5). It is gone,
 * and so is the `clientsByGroup` membership map that served it. The frame named a
 * circle **in cleartext on the wire, before the relay decided anything**: sending
 * one told the relay that a named circle exists, which is the exact sentence the
 * claim above denies. That it leaked nothing in practice rested on the fact that no
 * shipped client sent it (`RelayTransport` never had a group-publish path) — "nobody
 * happens to use it" is a convention, not a gate (`docs/conventions/enforceability.md`),
 * and the frame's mere presence in the protocol was the hole.
 *
 * A broadcast is now N `send` frames. The client already holds the roster (it is the
 * only party entitled to), so it loses one relay round-trip per member and the relay
 * loses the ability to learn a circle id at all. `test/security/` guards the removal:
 * the frame has no entry in `WIRE_FRAMES`, so a reintroduction fails the harness.
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
 * (legacy behaviour, fully backward compatible).
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
 *   - Each accepted-group entry may carry `quotas: { msgsPerDay? }`:
 *       * `msgsPerDay` counts `send` frames originated by
 *         that group's members; over-cap → `OVER_QUOTA_MSGS_PER_DAY`
 *         on the offending frame (socket stays open). Counter rolls
 *         over at 00:00 UTC.
 *       * `maxConnections` is GONE (2026-07-31) — see the header. Its
 *         per-connection successor is `maxAddressesPerConnection`.
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
import {
  MAX_ENVELOPE_BYTES, senderVerdict,
  newAddressChallenge, verifyAddressPossession, ADDRESS_CHALLENGE_TTL_MS,
} from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND }    from '@onderling/core';
import { MultiRecipientQueue }               from './MultiRecipientQueue.js';
import { ForwardQueue }                       from './ForwardQueue.js';
import { GroupAuthVerifier }                 from './GroupAuthVerifier.js';
import { PushTokenRegistry }                 from './push/PushTokenRegistry.js';
import { envelopeSuppressesWake }            from './push/wakePayload.js';
import { mountBlobGate }                     from './blobGateMount.js';
import { logHop }                            from './verbose.js';

const DEFAULT_PORT             = 8787;
// How long the relay holds a message for a peer that is not connected.
//
// Was 5 MINUTES until 2026-07-31, which quietly made "offline delivery" mean "offline for under five
// minutes": a phone in a pocket during a walk missed the message, and — because ForwardQueue's
// 'delivered'/'queued' return is not read by the caller — the sender was told nothing. The app's OWN hold
// queue (createSecureAgent, holdTtlMs) has always used 24 h, so the two layers disagreed by 288×about how
// long a message survives.
//
// 24 h, matching the app. What bounds MEMORY is the caps below, not this: each address holds at most
// `queueCapTotal` (200) messages regardless of TTL. What a longer TTL does grow is the NUMBER of addresses
// holding a buffer at once — bounded in practice by the eviction sweep, and `queueTtlMs` remains an option
// for a deployment that wants to trade retention for footprint.
// Parameter register (#36) — offline queue TTL + per-bucket cap (scope:device, kind:internal).
const DEFAULT_QUEUE_TTL        = param({ key: 'relay.queueTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 24 * 60 * 60_000 });  // 24 h — same as the app's hold queue
const DEFAULT_QUEUE_CAP        = param({ key: 'relay.queueCap', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 50 });
// Topic-aware queueing (Phase 7 step 4) caps each (addr, topic) bucket at
// `queueCap`; the per-address global cap is a safety valve so a publisher
// flooding many distinct topics can't memory-DoS the relay. Default is
// 4× queueCap, so up to 4 saturated topics fit before global FIFO eviction
// kicks in.
// Parameter register (#36) — global-cap ratio + push throttle (scope:device, kind:internal).
const DEFAULT_QUEUE_CAP_RATIO  = param({ key: 'relay.queueCapRatio', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 4 });
const DEFAULT_PUSH_THROTTLE_MS = param({ key: 'relay.pushThrottleMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });     // do not push more than once / 30s / address

// Default per-connection message rate limit (J-security flood defence).
// A token-bucket over the data-plane frame (`send`) so a
// single connection cannot flood a LIVE peer with unbounded messages in OPEN
// mode (the group-quota path only throttles grouped deployments; the offline
// queue caps only bound buffering to OFFLINE peers). Chosen to sit far above
// normal interactive chat/circle traffic (a human sends a handful of messages
// per second; a circle broadcast is now one `send` per member, so a circle of
// N costs N tokens rather than one) while capping a
// flood: `burst` messages may go through instantly, then `perSec` sustained.
// A 200-message instantaneous blast delivers ~`burst` then gets `OVER_RATE`.
// Parameter register (#36) — per-connection message rate limit (scope:device, kind:internal).
const DEFAULT_MSG_RATE_PER_SEC = param({ key: 'relay.msgRatePerSec', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 });
const DEFAULT_MSG_RATE_BURST   = param({ key: 'relay.msgRateBurst', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60 });

// Per-connection ceiling on how many addresses ONE socket may register.
//
// This is what remains of a connection cap after the per-GROUP one was removed (2026-07-31). It is
// deliberately per-connection rather than per-group or per-identity:
//   • per-group needs the relay to know circles, which is the thing it must not know (see header);
//   • per-identity is not yet meaningful — until registration demands proof of address possession
//     (DESIGN-boundary-authentication Decision 3), an "identity" here is a self-asserted string and a
//     cap keyed on it is bypassed by asserting another one. It becomes meaningful the day that lands.
// What it does buy, today: `register` is NOT rate-limited (the token bucket covers only the data plane),
// so one socket could otherwise grow `clients` without bound. This bounds a connection's footprint.
// What it does NOT buy: an attacker who opens more sockets. That is an operator concern (fd limits, a
// reverse proxy), not something the relay can settle without an identity it can verify — said here so
// this does not read as protection it is not.
// Set far above legitimate use: a device registers one address per circle it is in.
// Parameter register (#36) — per-connection address registration ceiling (scope:device, kind:internal).
const DEFAULT_MAX_ADDRESSES_PER_CONNECTION = param({ key: 'relay.maxAddressesPerConnection', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 64 });

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
 *   **Operator policy, not a security mechanism** (demoted 2026-07-31): *"my relay serves these
 *   circles"*.  If provided + non-empty, clients must present a valid `GroupManager`-issued proof in
 *   the `register` message for one of these groups.  If unset/empty, the relay is open.  Nothing in
 *   the security model depends on this — membership binds at the circle (seal + roster), not here.
 * @param {number} [opts.maxAddressesPerConnection=64]
 *   Per-connection ceiling on registered addresses (a device registers one per circle).  Over-cap
 *   `register` frames are refused with `TOO_MANY_ADDRESSES`; the socket and the addresses it already
 *   owns stay.  Replaces the removed per-group `quotas.maxConnections` — see the file header.
 * @param {Record<string, number>} [opts.roleRanks]
 *   Optional role-rank override for `requiredRole` checks (e.g. when an
 *   app registers custom roles via `Roles.registerCustomRole`).  Merged
 *   on top of the standard 5-role rank table.
 * @param {{ perSec?: number, burst?: number } | false} [opts.messageRateLimit]
 *   Default per-connection message rate limit (J-security flood defence),
 *   applied to `send` frames in EVERY mode (open + grouped;
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
    maxAddressesPerConnection = DEFAULT_MAX_ADDRESSES_PER_CONNECTION,
    // push wake-up.  When `pushSender` is null/undefined, the relay
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

  // token registry exists whenever `pushSender` is configured; otherwise
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
  // preserves the legacy behaviour — every existing relay test still passes.
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
  // `maxPayload` is the backstop: it protects the relay's own memory from a payload too big to buffer,
  // which the app-level check above cannot do because it runs after `ws` has already assembled the frame.
  // Given headroom over the app limit so the app check is what normally speaks — `ws` closing the socket
  // (1009) is the outcome we are trying to avoid, not the one we want.
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_ENVELOPE_BYTES * 4 });

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
    // Deferred by an arrow: tellSenderWeGaveUp is declared below, and only ever CALLED later.
    onGiveUp:      (info) => tellSenderWeGaveUp(info),
  });
  /**
   * address → groupId — the relay's ONE surviving membership map, and it survives for exactly one
   * reader: the Phase 2A `msgsPerDay` quota on the `send` path (below), which has to know whose
   * daily allowance a frame spends. It is a cost cap on a circle the operator already named in
   * `acceptedGroups`, never an authorization decision.
   *
   * `clientsByGroup` (groupId → Set<address>) used to sit next to it; it went with the
   * `group-publish` fan-out on 2026-07-31 (see the header), which was its only reader once the
   * per-group connection quota was removed. A relay no longer holds a set of who is in a circle —
   * only, per address, which circle's meter to charge, and only when an operator configured a meter.
   */
  const groupByAddress = new Map();
  /**
   * Phase 2A — per-group msgsPerDay counters.
   *   groupId → { day: <YYYY-MM-DD UTC>, count: number }
   * Day rolls over at 00:00 UTC; counters reset on roll-over.  Pure
   * in-memory; persistence across restarts is not promised (matches
   * the existing relay state — neither clients nor the queue
   * survives a restart either).  This is a per-group quota and therefore
   * still costs the relay group knowledge; it survives only because it is
   * operator cost policy on a circle the operator already chose to serve
   * (`acceptedGroups`), never an authorization decision.
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
   * bucketing (Phase 7 step 4). Delegates to the shared ForwardQueue (which
   * fires `onWake` → `tryWakePush` on a buffered delivery). ForwardQueue's
   * `'delivered'`/`'queued'` return is passed through but no longer read
   * here — the fan-out that summarised it is gone (see the header).
   */
  /**
   * The queue gave up on an envelope — tell whoever sent it, if they are still connected.
   *
   * **Why this reports the GIVE-UP and not `queued` vs `delivered`.** The obvious reading of "the sender
   * is never told" is to pass ForwardQueue's `'delivered'`/`'queued'` return back. That would be a
   * PRESENCE ORACLE: anyone could learn whether any address is connected right now by sending it one
   * message and reading the answer, on demand, invisibly. This product's whole delivery vocabulary is
   * built to avoid exactly that (`deliveryState.js` dropped `reached-device` for the same reason —
   * it let you identify a peer who had turned receipts off).
   *
   * A give-up is different in kind. It is coarse (after the TTL, not "right now"), it is unsolicited
   * rather than probeable, and it carries something the sender NEEDS: their message did not arrive.
   * Best-effort by design — 24 h later the sender is usually on another socket, and the app's own state
   * is what covers that case.
   */
  const tellSenderWeGaveUp = ({ envelope, reason }) => {
    const from = envelope?._from;
    if (!from || !envelope?._id) return;
    const socket = clients.get(from);
    if (!socket || socket.readyState !== 1) return;
    try {
      socket.send(JSON.stringify({ type: 'undelivered', id: envelope._id, reason }));
    } catch { /* the sender's socket raced a close; their own state still covers it */ }
  };

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
    // the day quota, multi-recipient responses, logs) are about the DEVICE, not the circle it is
    // speaking in. `registeredAddresses` is the routing set.
    let registeredAddress = null;
    const registeredAddresses = new Set();
    /**
     * nonce → { address, expiresAt, meterGroupId } — challenges this socket has been issued and
     * not yet answered (Decision 3). Per SOCKET, not global: a nonce is only answerable on the
     * connection that was handed it, so a proof lifted off one connection is useless on another.
     * It dies with the socket, which is why nothing sweeps it on a timer.
     */
    const openChallenges = new Map();
    /** The push token this socket registered, if any — reapplied to every address it later registers. */
    let socketPushToken = null;
    // J-security: per-connection message rate limit (flood defence). One
    // bucket per socket — absorbs bursts, throttles a sustained flood. Null
    // when disabled via `messageRateLimit: false`.
    const msgBucket = rateLimitCfg ? createTokenBucket(rateLimitCfg) : null;

    /**
     * ── Sender binding — second line, NOT the wall (2026-07-31) ────────────────────────────────
     *
     * A socket may only forward envelopes claiming a sender it has registered. Until now the relay
     * forwarded whatever `_from` a frame carried, so any connected client could speak as any address it
     * could name — including one belonging to somebody else's socket.
     *
     * ONE RULE. This is `senderVerdict` from `@onderling/core` — the same rule the NKN
     * transports ask — with the relay's own `authenticatedSender` port: *which addresses is this
     * connection authenticated to speak as?* On a transport that answer is one address; here it is the
     * socket's registration SET, because one device legitimately owns many per-circle aliases. An
     * empty set is a real answer ("registered as nobody yet"), not a missing one, so a claim from an
     * unregistered socket mismatches rather than sliding through the unchecked path.
     *
     * What this is NOT:
     *   • A hostile or compromised relay sits entirely outside this check, because the relay is the thing
     *     doing the checking.
     *   • It binds a sender to a SOCKET, not to a key. In GROUPED mode that is worth something —
     *     `verifyBound` ties each registered address to the group proof's `memberPubKey`, so an attacker
     *     cannot register someone else's address in the first place. In OPEN mode (no `acceptedGroups`)
     *     registration is unauthenticated, so an impersonator can simply register the victim's address
     *     and then pass this check — at the cost of hijacking that address's inbound routing
     *     (`clients.set` overwrites), which is loud rather than silent. Open mode is a dev/test posture;
     *     say so rather than let this read as protection it is not.
     * The real fix — the signing key IS the identity, authorised against the circle roster — is the
     * circle layer's sealing + roster work, a separate build.
     *
     * The relay CAN see the claim: `SecurityLayer.encrypt` replaces only `envelope.payload` with
     * `{_box}`; `_from`/`_to`/`_p`/`_id`/`_sig` stay plaintext at the top level (which is also why the
     * log lines can print `envelope._p`). It is a claim, not a proof — that is the point.
     *
     * Absent `_from` is forwarded, not refused (`no-claimed-sender`). Plenty of legitimate wire users
     * hand `_put` a bare payload object with no envelope fields at all, and refusing those would break
     * working traffic to buy nothing: an envelope with no `_from` is useless to an impersonator, since
     * the receiving `SecurityLayer` rejects it with UNKNOWN_SENDER before it reaches an application.
     *
     * REFUSE THE FRAME, DON'T CLOSE THE SOCKET. One socket legitimately owns many addresses and registers
     * them over time, so a mis-timed frame is a plausible honest mistake; killing the connection would
     * take every OTHER circle on that device down with it. It also matches how this file already treats
     * data-plane refusals (OVER_RATE, OVER_QUOTA, "not a member of this group" all refuse and keep the
     * socket) — only register-time auth failures close. Called AFTER the rate limiter on purpose: a flood
     * of spoofed frames should be throttled before it can make us emit an error frame per message.
     *
     * @returns {boolean} true when the frame was refused (the caller must stop).
     */
    const refuseUnboundSender = (envelope, kind) => {
      const verdict = senderVerdict(null, envelope, () => [...registeredAddresses]);
      if (verdict.ok) return false;
      socket.send(JSON.stringify({ type: 'error', message: 'SENDER_NOT_REGISTERED' }));
      logLine(`[relay] sender-rejected ${shortId(registeredAddress)} ${kind} claimed ${shortId(verdict.claimed)}`);
      return true;
    };

    socket.on('message', (raw) => {
      // Size first, before parsing — a refusal must not require us to build the object we are refusing.
      //
      // The relay also sets `maxPayload` on the server (see startRelay), but that is the LAST line rather
      // than the first: when `ws` enforces it, it closes the connection with code 1009 and the sender
      // cannot tell a refusal from the peer going offline. Checking here lets us answer. Walked
      // 2026-07-29 (S6/J-A14): before either check, a 64 MB envelope was forwarded intact.
      const size = typeof raw?.length === 'number' ? raw.length : byteLengthOf(raw);
      if (size > MAX_ENVELOPE_BYTES) {
        try {
          socket.send(JSON.stringify({
            type: 'error', reason: 'envelope-too-large',
            message: `envelope is ${size} bytes, over the ${MAX_ENVELOPE_BYTES}-byte limit`,
          }));
        } catch { /* the socket may already be gone; the drop is the point */ }
        return;
      }
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // ── register — step 1 of 2: the relay CHALLENGES, and registers nothing ──
      //
      // This branch cannot accept a registration; `clients.set` is not reachable from it. That is
      // the structural half of Decision 3, and `test/security/circleBlindDecisions.test.js` asserts
      // it rather than trusting this comment.
      if (msg.type === 'register') {
        const { address, groupProof, rotationProof } = msg;
        if (!address) {
          socket.send(JSON.stringify({ type: 'error', message: 'Missing address' }));
          return;
        }

        // Q-E.2 + Phase 2 (Stoop V1, 2026-05-05): apply the operator's
        // serving policy when configured — "my relay serves these circles".
        // NOT a membership boundary (see the header): membership binds at the
        // circle, via the seal and the roster, on every transport.
        // In open mode (no acceptedGroups),
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

        // Expired challenges are swept here rather than on a timer: this is the only place new ones
        // appear, and the whole map dies with the socket anyway.
        for (const [n, c] of openChallenges) if (c.expiresAt <= Date.now()) openChallenges.delete(n);
        const claimedHere = new Set([...openChallenges.values()].map(c => c.address));

        // Per-connection address ceiling (2026-07-31, replacing the per-group connection quota — see the
        // file header). Circle-blind: it asks only "how much is this ONE socket holding", never "whose
        // circle is this". Checked before we mutate anything so a refused registration leaves no residue.
        // A REPEAT register of an address this socket already owns — or already has a challenge out for
        // — is free: it is not new state. Addresses merely CHALLENGED count towards the ceiling, or a
        // connection could sit on the whole table's worth of them by never answering.
        const alreadyClaimed = registeredAddresses.has(address) || claimedHere.has(address);
        if (!alreadyClaimed
            && (registeredAddresses.size + claimedHere.size) >= maxAddressesPerConnection) {
          socket.send(JSON.stringify({ type: 'error', message: 'TOO_MANY_ADDRESSES', address }));
          logLine(`[relay] addr-cap-rejected ${shortId(address)} (max=${maxAddressesPerConnection})`);
          // Refuse the FRAME, keep the socket: the addresses already registered on it are legitimate and
          // still carry traffic for other circles. Only register-time AUTH failures close the connection.
          return;
        }
        // …and a hard ceiling on OUTSTANDING challenges, which the rule above deliberately does not
        // bound: re-registering one address is free, so without this a socket could ask for the same
        // address a million times and make us hold a million nonces. Generous, because several
        // challenges for one address in flight at once is ordinary (a reconnect racing a rebind) —
        // this bounds memory, it is not a policy anyone should meet.
        if (openChallenges.size >= maxAddressesPerConnection * 4) {
          socket.send(JSON.stringify({ type: 'error', message: 'TOO_MANY_CHALLENGES', address }));
          logLine(`[relay] challenge-cap-rejected ${shortId(address)}`);
          return;
        }

        // The challenge. Fresh per register attempt, single-use, short-lived — the three properties
        // that make "did this relay demand a fresh proof" a question with an answer, and make a
        // captured proof worthless anywhere else. Keyed by NONCE, not by address, so two registers
        // of the same address in flight are two independent challenges rather than one silently
        // cancelling the other's answer.
        const nonce = newAddressChallenge();
        openChallenges.set(nonce, {
          address,
          expiresAt: Date.now() + ADDRESS_CHALLENGE_TTL_MS,
          // The operator's serving policy, decided above and carried to step 2 so the answer is not
          // re-litigated between the two frames. Never re-read as an accept/reject input.
          meterGroupId: auth.group?.groupId ?? null,
        });
        socket.send(JSON.stringify({ type: 'challenge', address, nonce }));
        return;
      }

      // ── register-proof — step 2 of 2: the only path to a routing-table entry ─
      if (msg.type === 'register-proof') {
        const { address, nonce, proof } = msg;
        const challenge = typeof nonce === 'string' ? openChallenges.get(nonce) : null;
        if (!challenge || challenge.address !== address) {
          // An answer to a nonce we did not just issue on this socket, or one lifted onto a
          // different address than it was issued for. Both are the same fact: nothing here was
          // asked for. (A proof captured elsewhere lands here too — it names a nonce we never had.)
          socket.send(JSON.stringify({ type: 'error', message: 'NO_CHALLENGE', address }));
          return;
        }
        // SINGLE USE — spent the moment it is answered, right or wrong, and before we verify.
        // A nonce that survived a failed answer would be a nonce an attacker may keep guessing
        // against, and a nonce that survived a GOOD answer would be replayable onto a second
        // socket. Another attempt means another `register`, which means another nonce.
        openChallenges.delete(nonce);
        if (Date.now() > challenge.expiresAt) {
          socket.send(JSON.stringify({ type: 'error', message: 'CHALLENGE_EXPIRED', address }));
          return;
        }
        // THE CHECK. Verified against the ADDRESS, because the address is the public key. No
        // lookup, nothing to substitute, no issuer to consult.
        if (!verifyAddressPossession({ address, nonce, proof })) {
          socket.send(JSON.stringify({ type: 'error', message: 'PROOF_INVALID', address }));
          logLine(`[relay] proof-rejected ${shortId(address)}`);
          // Refuse the FRAME, keep the socket — the same rule as every other register-time refusal
          // that is not the operator's serving policy. One socket legitimately owns many addresses;
          // a device whose signer for ONE circle is broken must not lose the others. The attacker
          // gains nothing from the socket staying open: every further attempt needs a fresh
          // challenge, and no number of them makes an unheld key signable.
          return;
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

        // Phase 2A: remember which meter this address spends against, for the `msgsPerDay` quota.
        // Null in open mode; otherwise the groupId the operator's own config matched at challenge
        // time. The reverse map (groupId → members) went with the fan-out on 2026-07-31 — the quota
        // only ever needed to charge one address, never to enumerate a circle.
        if (challenge.meterGroupId) {
          groupByAddress.set(address, challenge.meterGroupId);
        }

        // The ack names the address, because a socket registers several and a client has to know
        // WHICH one it just proved — that is what lets it refuse a `registered` it never answered a
        // challenge for (the client-audits-the-relay half of Decision 3).
        socket.send(JSON.stringify({ type: 'registered', address }));
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

        // Sender binding — the shared rule, applied to every `send` frame. Full reasoning (and the
        // limits) at `refuseUnboundSender` above.
        if (refuseUnboundSender(envelope, 'send')) return;

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

      // (`group-publish` used to sit here — removed 2026-07-31, see the file header. An
      // incoming frame of that type now falls through to the end of this handler and is
      // ignored like any other unknown type.)

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

      // ── nothing matched ───────────────────────────────────────────────────
      // Say so. Until 2026-08-03 this if-chain simply ENDED: an unrecognised frame was accepted, matched
      // nothing, and vanished — no error to the sender, no line in the log, no counter. A client on a
      // newer build talking to an older relay would look like a network fault; a typo in a frame type
      // would look like nothing at all.
      //
      // Deliberately a LOG, not an error frame back to the sender: replying would tell an unauthenticated
      // peer which frame types this relay knows, which is free reconnaissance. The operator needs to know;
      // the sender does not get to enumerate.
      logLine(`[relay] unknown-frame  ${shortId(registeredAddress ?? 'unregistered')}  type=${
        typeof msg?.type === 'string' ? msg.type.slice(0, 40) : typeof msg?.type
      }`);
    });

    socket.on('close', () => {
      if (registeredAddress) {
        // Every address this socket owned goes with it — leaving one behind would route to a dead socket.
        for (const addr of registeredAddresses) clients.delete(addr);
        // Phase 2A — drop the address→group lookup so per-day-msg gating
        // doesn't leak stale slots.
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


/** Byte length of whatever the socket handed us (Buffer, ArrayBuffer, or string). */
function byteLengthOf(raw) {
  if (raw == null) return 0;
  if (typeof raw === 'string') return Buffer.byteLength(raw);
  if (typeof raw.byteLength === 'number') return raw.byteLength;
  return 0;
}
