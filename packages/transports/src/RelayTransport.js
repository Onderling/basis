/**
 * RelayTransport — WebSocket relay server transport.
 *
 * The relay server is a simple message broker: agents register by address,
 * and the relay forwards envelopes to the correct connected client.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Relay: { type: 'register', address: '<pubKey>' }
 *   Relay  → Client: { type: 'challenge', address, nonce }
 *   Client → Relay: { type: 'register-proof', address, nonce, proof }
 *   Relay  → Client: { type: 'registered', address }
 *   Client → Relay: { type: 'send', to: '<address>', envelope: { ... } }
 *   Relay  → Client: { type: 'message', envelope: { ... } }
 *   Relay  → Client: { type: 'error', message: '<reason>' }
 *
 * PROVING AN ADDRESS, AND AUDITING THE RELAY (2026-07-31, DESIGN-boundary-authentication §7):
 *
 * Registration is challenge-first in both directions. We prove we hold the key behind every address
 * we register — each address separately, because a device holds a DIFFERENT key per circle and
 * proving one says nothing about another — and we REFUSE A RELAY THAT DOES NOT ASK.
 *
 * The second half is the unusual one, and it is deliberate: a relay that never demands proof is, by
 * construction, a relay where anyone may claim anyone's address and take over their inbound
 * traffic. That is a property of the relay, not of how well we behave, so volunteering a signature
 * to it buys nothing. A `registered` we never answered a challenge for is therefore a CONNECTION
 * FAILURE, reported by name, with no fallback to unproven registration — a partial mode would be
 * exactly the invisible downgrade the rule exists to remove. We stop reconnecting to such a relay:
 * retrying a relay that is wrong about what it must ask for is not a transient condition.
 *
 * ⚠ This breaks against any relay not yet upgraded. That is inside the no-backcompat licence, which
 * runs to 2026-08-31 (`docs/conventions/naming-and-compatibility.md`); after that date the same
 * change needs a negotiated capability and a migration window.
 *
 * Push wake-up (E2c, opt-in on relay):
 *   Client → Relay: { type: 'register-push-token',   token, platform }
 *   Relay  → Client: { type: 'push-token-registered' }
 *   Client → Relay: { type: 'unregister-push-token' }
 *   Relay  → Client: { type: 'push-token-unregistered' }
 *
 * Reconnect: automatically reconnects with exponential backoff on close/error.
 * Uses `ws` in Node.js; falls back to globalThis.WebSocket in browsers.
 */
import {
  Transport, addressPossessionMessage, signAddressPossession, b64encode, relayNameOf, relayAddressRefusal,
} from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { parseUntrustedJson } from '@onderling/core';

/** Error frames that refuse ONE frame (a send) rather than a registration — never a reason to fail a pending bind. */
const PER_FRAME_REFUSALS = new Set(['SENDER_NOT_REGISTERED', 'OVER_RATE', 'OVER_QUOTA_MSGS_PER_DAY']);

// Parameter register (#36) — reconnect backoff ceiling + push-ack timeout (scope:device, kind:internal).
const MAX_BACKOFF_MS = param({ key: 'transports.maxBackoffMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });
const PUSH_ACK_TIMEOUT_MS = param({ key: 'transports.pushAckTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5_000 });
// A send AS an address waits for that address's bind on this socket; past this it is said, with why the bind was lost.
const BIND_WAIT_WARN_MS = param({ key: 'transports.bindWaitWarnMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2_000 });
// How long `disconnect()` waits for the socket's own close before it gives up waiting (the close still proceeds).
const CLOSE_WAIT_MS = param({ key: 'transports.closeWaitMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2_000 });
// A FRAME THE RELAY REFUSED AS OVER-RATE IS SENT AGAIN (ledger L1061). The relay's per-connection token bucket drops an
// over-rate `send` and answers `OVER_RATE` naming the envelope's id; this transport keeps what it sent for a while, so
// it can send exactly that frame again, paced, a capped number of times — after which the give-up path is told.
// How long a sent frame is kept for a possible refusal (the relay answers at once; this covers a slow socket)…
const OVER_RATE_KEEP_MS = param({ key: 'transports.overRateKeepMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10_000 });
// …and how many at most (the oldest go first).
const OVER_RATE_KEEP_MAX = param({ key: 'transports.overRateKeepMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2_000 });
// The wait after a refusal before the first re-send: the relay's bucket (30/s by default) has refilled by then.
const OVER_RATE_RESEND_DELAY_MS = param({ key: 'transports.overRateResendDelayMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1_000 });
// The pace of re-sends: one at a time, well under the relay's default limit (30/s), so a re-send never floods.
const OVER_RATE_RESEND_PER_SEC = param({ key: 'transports.overRateResendPerSec', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 10 });
// How often one frame is sent in all before it is given up (the first send included).
const OVER_RATE_MAX_ATTEMPTS = param({ key: 'transports.overRateMaxAttempts', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 });
// How old a refused frame may be and still be sent again (from its signed `_ts`, else its first write). A receiver drops
// a frame older than its replay window (`security.replayWindowMs`, ten minutes): well under that, so a re-sent frame can
// still be taken; past it the frame is given up and said, also while the socket is down (a test pins the agreement).
export const OVER_RATE_MAX_AGE_MS = param({ key: 'transports.overRateMaxAgeMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5 * 60 * 1_000 });
// How many refused frames may wait for a re-send at once; one more is given up and said, not held.
const OVER_RATE_QUEUE_MAX = param({ key: 'transports.overRateQueueMax', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1_000 });
// A frame written this shortly before its socket closed may have lost its refusal with the socket: it is sent once more
// on the next socket (a receiver drops a copy it already holds by its id). Older ones would have had their answer.
const UNANSWERED_AT_CLOSE_MS = param({ key: 'transports.unansweredAtCloseMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 2_000 });
// THIS TRANSPORT PACES ITS OWN SENDS UNDER THE RELAY'S LIMIT (the start burst, 2026-11-20): the relay counts `send` frames per socket in
// a token bucket (30 a second, a burst of 60, `relay.msgRatePerSec` / `relay.msgRateBurst`) and refuses what is over it.
// This keeps its own bucket WELL below that, so a start's burst is held here and sent as it allows. Well below, because the
// relay counts frames on ARRIVAL and paced writes can arrive bunched: on the Samsung at 25 a second with a burst of 50 a
// cold start was still refused (76, 8); at 20 with a burst of 20 it was not (0, 0) bar one bunch over adb reverse. A
// test pins that these stay at or under the relay's.
const RELAY_SEND_PER_SEC = param({ key: 'transports.relaySendPerSec', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20 });
const RELAY_SEND_BURST = param({ key: 'transports.relaySendBurst', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 20 });
/** The pace this transport keeps on `send` frames (for the agreement test with the relay's own limit). */
export const RELAY_SEND_RATE = Object.freeze({ perSec: RELAY_SEND_PER_SEC, burst: RELAY_SEND_BURST });

/**
 * WebSocket relay-server `Transport`: registers this agent's address with the relay, which
 * forwards envelopes between connected clients. Reconnects automatically with exponential
 * backoff (capped at 30s) until `disconnect()`. Also supports the relay's opt-in push wake-up
 * protocol (`registerPushToken`/`unregisterPushToken`). Uses `ws` in Node.js and falls back to
 * `globalThis.WebSocket` in browsers.
 */
export class RelayTransport extends Transport {
  #ws        = null;
  #relayUrl;
  /** Did THIS client turn the relay's peer discovery on? Off (the default, as on the relay) = a peer list is not asked
   *  for, and one that arrives anyway is the relay's word only: dropped, never turned into found peers. */
  #peerDiscovery = false;
  #backoffMs = 1_000;
  #stopped   = false;
  #connectPromise = Promise.resolve();  // starts resolved; reset on close
  #connectResolve = null;               // resolve fn for the current connect promise
  #knownPeers = new Set();              // addresses already emitted as peer-discovered
  /** Pending push-control acks: [{ackType, resolve, reject, timer}, ...]. FIFO. */
  #pendingPushAcks = [];
  /**
   * The audit state, per socket (both are cleared on every (re)connect — a new socket has proved
   * nothing yet, and neither has the relay behind it):
   *   `#asked`  — addresses we sent `register` for on THIS socket. We answer a challenge only for
   *               one of these, so an unsolicited challenge gets nothing; it is NOT cleared when
   *               answered, because a register replayed over a reconnect race may be challenged
   *               more than once and each challenge is legitimately ours to answer;
   *   `#proved` — addresses we answered a challenge for on THIS socket.
   * A `registered` for an address not in `#proved` is a relay that did not demand proof.
   */
  #asked             = new Set();
  #proved            = new Set();
  /** address → proofs sent on THIS socket whose `registered` ack has not come yet (each ack spends one). */
  #proofsInFlight    = new Map();
  /** Aliases the relay has ACKED on THIS socket — what an awaited `addAddress` promises. Cleared with every new socket. */
  #bound             = new Set();
  /** address → why (and when) it last left `#bound` — what a send that then waits for it can say. */
  #unboundWhy        = new Map();
  #primaryDevice = () => false;
  #primaryAcked = false;
  /** What this node serves the relay's seat (its own address only), sent on its own register frame. */
  #serves = [];
  /** alias address → `primary: true` when it registers as the primary (from `addAddress`). */
  #primaryFlags = new Map();
  /** address → true once this device stepped DOWN from primary for it: it then registers as a standby (never takes a held address). */
  #standbyFlags = new Map();
  /** alias address → the caller's `sign(message)` (from `addAddress`). The primary uses `identity`. */
  #signers           = new Map();
  /** Set once this relay has failed the audit — we do not reconnect to it, and say why. */
  #unprovenRelay     = false;
  /**
   * alias address → the `_bindAddress` call still waiting for that address's `registered` ack.
   *
   * `addAddress()` used to resolve as soon as the `register` frame was WRITTEN, which read as
   * success while the relay had not yet challenged us, let alone accepted. Harmless while a device
   * only ever SENT as its primary address; since Decision 4 it also sends AS the alias, and the
   * relay refuses a frame whose `_from` it has not registered — so an awaited `addAddress` followed
   * immediately by a send silently lost the first messages of every circle. Awaiting the ack makes
   * `addAddress` mean what its callers already assumed: the relay agrees this address is ours.
   * @type {Map<string, {resolve: Function, reject: Function, timer: any}>}
   */
  #pendingBinds      = new Map();
  /** envelope id → `{to, envelope, at, attempts}`: frames sent lately, kept in case the relay refuses one as over-rate. */
  #sentFrames        = new Map();
  /** Frames the relay refused as over-rate, in the order it refused them, waiting for their paced re-send. */
  #overRateQueue     = [];
  #overRateTimer     = null;
  /** A re-send in progress (its sender's bind may be awaited): no second one starts beside it, so the pace holds. */
  #overRateBusy      = false;
  /** `{delayMs, perSec, maxAttempts}` — the register's values unless the composition (a test) narrows them. */
  #overRate;
  /** The own pace (see RELAY_SEND_RATE): a token bucket, and what waits for a token in two classes — what a person waits
   *  on first, background sends (catch-ups, re-announces) after; in order within each. */
  #pace = { perSec: RELAY_SEND_PER_SEC, burst: RELAY_SEND_BURST, tokens: RELAY_SEND_BURST, at: 0 };
  #waitingForeground = [];
  #waitingBackground = [];
  #paceTimer         = null;

  /**
   * @param {object} opts
   * @param {string}  opts.relayUrl  — ws:// or wss:// relay URL
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   */
  constructor(opts) {
    if (!opts?.relayUrl)  throw new Error('RelayTransport requires relayUrl');
    if (!opts?.identity)  throw new Error('RelayTransport requires identity');
    // TLS outside local development: plain ws only to the own machine or network (`relayAddressRefusal`). Here, where
    // the socket is made, so every client is held by it, whichever screen, setting or invite handed over the address.
    if (relayAddressRefusal(opts.relayUrl) === 'plain-on-public-host') {
      const err = new Error(`RelayTransport: ${opts.relayUrl} is a plain ws address to a public host; a relay outside the `
        + 'own machine or network is dialled over TLS: use wss:// instead.');
      err.code = 'RELAY_PLAIN_WS';
      throw err;
    }
    super({ address: opts.identity.pubKey, identity: opts.identity });
    this.#relayUrl = opts.relayUrl;
    this.#peerDiscovery = opts.peerDiscovery === true;
    // THE PRIMARY REGISTRATION (sync-policy §12): is THIS device the one the person chose for direct messages? Read
    // at every socket open (a function, so the choice can move without a new transport) and sent on the socket's
    // own `register` as `primary: true`; the relay then delivers to this socket while it lives, and a plain
    // registration by another of the person's devices stands by. Absent → plain, as before.
    this.#primaryDevice = typeof opts.primaryDevice === 'function' ? opts.primaryDevice : () => opts.primaryDevice === true;
    // What this node serves the relay's own seat, said by the node ITSELF on its own register frame (`['feed']`: the
    // relay may forward a person's agenda link here). The relay asks no node that did not say so. Absent → nothing.
    this.#serves = Array.isArray(opts.serves) ? opts.serves.filter((x) => typeof x === 'string') : [];
    // Called when the relay reports it gave up on a message we sent (see the 'undelivered' frame below).
    // A plain assignable property rather than an event emitter — this class has no emitter, and one
    // consumer is all this has ever needed.
    this.onUndelivered = typeof opts.onUndelivered === 'function' ? opts.onUndelivered : null;
    const o = opts.overRateResend ?? {};
    const pos = (v, d) => (Number.isFinite(v) && v > 0 ? v : Number(d));
    this.#overRate = {
      delayMs: pos(o.delayMs, OVER_RATE_RESEND_DELAY_MS),
      perSec: pos(o.perSec, OVER_RATE_RESEND_PER_SEC),
      maxAttempts: Math.max(1, Math.floor(pos(o.maxAttempts, OVER_RATE_MAX_ATTEMPTS))),
      maxAgeMs: pos(o.maxAgeMs, OVER_RATE_MAX_AGE_MS),
      maxQueued: Math.max(1, Math.floor(pos(o.maxQueued, OVER_RATE_QUEUE_MAX))),
      unansweredAtCloseMs: pos(opts.unansweredAtCloseMs, UNANSWERED_AT_CLOSE_MS),
    };
    const pc = opts.sendPace ?? {};
    this.#pace.perSec = pos(pc.perSec, RELAY_SEND_PER_SEC);
    this.#pace.burst = pos(pc.burst, RELAY_SEND_BURST);
    this.#pace.tokens = this.#pace.burst;
  }

  // G13 — extra addresses. The alias SET, the public API and the replay rule live in the base `Transport`
  // (one implementation for every adapter); this only says how a relay binds one: another `register` frame
  // on the same socket, which the relay accepts (step A).
  get supportsAliases() { return true; }

  /** The relay this socket dials. Routing narrows a circle-scoped send to the relays the circle recorded by
   *  comparing THIS against the scope's points — with more than one relay up, a transport that cannot say
   *  which relay it is would be eligible for every circle (2026-09-08). */
  get url() { return this.#relayUrl; }
  /** What this socket holds, for a diagnosis line: the addresses it asked the relay for, and which of them the relay acked. */
  get registrations() {
    return { asked: [this.address, ...this.#signers.keys()].filter(Boolean), acked: [...this.#bound] };
  }

  /**
   * `addAddress` means "the relay agrees this address is ours ON THIS SOCKET" — for every caller, not only the
   * first. The base is idempotent (a known alias answers ok at once) and a bind made while the socket was closed
   * is replayed on connect; together they let a second caller read "ok" while the replay's proof was still in
   * flight, send as the alias, and be refused as an unregistered sender (the runner's enrol walk, 2026-09-16).
   * So a known alias that this socket has not acked yet waits for the ack — the in-flight one, or a fresh one.
   */
  async addAddress(address, opts = {}) {
    const r = await super.addAddress(address, opts);
    if (!r?.ok || address === this.address || !this.connected || this.#bound.has(address)) return r;
    try { await this.#ensureBound(address); return { ok: true }; }
    catch (err) { return { ok: false, reason: err?.message ?? 'bind-failed' }; }
  }

  /** Resolve once the relay has acked `address` on this socket: join the bind in flight, or start one. */
  #ensureBound(address) {
    if (this.#bound.has(address)) return Promise.resolve();
    const pending = this.#pendingBinds.get(address);
    if (pending) {
      return new Promise((resolve, reject) => {
        const { resolve: res0, reject: rej0 } = pending;
        pending.resolve = () => { res0(); resolve(); };
        pending.reject = (err) => { rej0(err); reject(err); };
      });
    }
    this.#sendRegister(address, this.#primaryFlags.get(address) === true);
    return this.#awaitBound(address);
  }

  async _bindAddress(address, opts) {
    // Refuse locally what the relay would refuse anyway, and say which of the two it was. Without a
    // signer for this alias we cannot answer its challenge, so registering it is not something that
    // "usually works" — it is something that never works. Failing here makes it one reported result
    // (`addAddress` → `{ok:false}`) instead of a registration that silently never completes.
    if (address !== this.address && typeof opts?.sign !== 'function') {
      throw new Error('no signer for this address — pass addAddress(address, { sign }) so it can '
        + 'prove possession to the relay');
    }
    this.#signers.set(address, opts.sign);
    // stepping DOWN (it was this device's primary and is no longer): from here it registers as a standby
    if (this.#primaryFlags.get(address) === true && opts?.primary !== true) this.#standbyFlags.set(address, true);
    if (opts?.primary === true) this.#standbyFlags.delete(address);
    this.#primaryFlags.set(address, opts?.primary === true);
    if (!this.connected) return;      // replayed by `_rebindAddresses()` on the next connect
    if (this.#bound.delete(address)) this.#unboundWhy.set(address, { why: 'flag-moved', at: Date.now() });   // a rebind (the flag moved) waits for the relay's fresh ack
    this.#sendRegister(address, opts?.primary === true);
    await this.#awaitBound(address);
  }

  /**
   * The person's choice of primary device moved: re-register the socket's own address with the new flag now (a
   * reconnect would read it anyway). Aliases keep their own flag (`addAddress(address, { sign, primary })`).
   */
  async setPrimaryDevice(isPrimary) {
    // stepping DOWN (this socket held the person's address as primary and another device is now chosen): register as a
    // STANDBY from here on — take the address only if no live socket holds it. A plain registration would take it back
    // from the new primary in the moment before that one's primary registration is proven (the relay's last-plain rule).
    if (isPrimary !== true && this.#primaryDevice() === true) this.#standbyFlags.set(this.address, true);
    if (isPrimary === true) this.#standbyFlags.delete(this.address);
    this.#primaryDevice = () => isPrimary === true;
    if (!this.connected) return { ok: true, pending: true };
    if (this.#bound.delete(this.address)) this.#unboundWhy.set(this.address, { why: 'primary-moved', at: Date.now() });
    this.#sendRegister(this.address, isPrimary === true);
    try { await this.#awaitBound(this.address); return { ok: true }; }
    catch (err) { return { ok: false, reason: err?.message ?? 'bind-failed' }; }
  }
  /** What this socket's own registration currently claims. */
  get primaryDevice() { return this.#primaryDevice() === true; }

  /**
   * Resolve when the relay acks THIS address, reject if it never does.
   *
   * A rejection leaves the alias in the base class's replay set on purpose: the address is still
   * ours and the next reconnect re-proves it. What it must not do is report success.
   */
  #awaitBound(address) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingBinds.delete(address);
        reject(new Error(`Relay: no acknowledgement for ${String(address).slice(0, 12)}… within 5s`));
      }, 5_000);
      this.#pendingBinds.set(address, { resolve, reject, timer });
    });
  }

  /** Settle a pending `_bindAddress` (ack, or a socket that died under it). */
  #settleBind(address, err = null) {
    const pending = this.#pendingBinds.get(address);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.#pendingBinds.delete(address);
    if (err) pending.reject(err); else pending.resolve();
  }

  /** Fail every outstanding bind — the socket went away before the relay answered. */
  #settleAllBinds(err) {
    for (const address of [...this.#pendingBinds.keys()]) this.#settleBind(address, err);
  }

  // A socket cannot un-register a single address today, so removal takes effect on the next reconnect —
  // the base class has already dropped it from the replay set, which is what makes that true.
  _unbindAddress(address) {
    this.#signers.delete(address);
    this.#proved.delete(address);
    this.#proofsInFlight.delete(address);
    this.#asked.delete(address);
    if (this.#bound.delete(address)) this.#unboundWhy.set(address, { why: 'removed', at: Date.now() });
  }

  /** True when the WebSocket is open and registered with the relay. */
  get connected() { return this.#ws?.readyState === 1; }

  /**
   * Routing hint (Group EE): a relay can reach any peer *only if* its own
   * WebSocket is open.  When the WS is null/closed/closing, RoutingStrategy
   * should skip this transport instead of trying it and cascading the
   * classic `Cannot read property 'send' of null` failure.
   */
  canReach(_peerId) { return this.connected; }

  async connect() {
    // A relay that failed the audit stays refused for the life of this transport. Reconnecting
    // would re-ask a question we already have the answer to, and the answer disqualifies it.
    if (this.#unprovenRelay) {
      this.emit('error', new Error(
        `Relay: ${this.#relayUrl} does not demand proof of address possession — refusing to register.`,
      ));
      return;
    }
    this.#stopped = false;
    this.#resetConnectPromise();
    // Connect in the background — do NOT await. agent.start() must not block
    // on relay because #openSocket() only resolves when the server sends
    // 'registered', which never happens when the relay is unreachable.
    // _put() already awaits #connectPromise internally, so sends queue safely.
    this.#openSocket().catch(() => {});
  }

  async disconnect() {
    this.#stopped = true;
    this.#knownPeers.clear();
    this.#settleAllBinds(new Error('Relay: transport disconnected before the address was acknowledged'));
    this.#refusePaced();
    // A refused frame still waiting for its re-send will not get one: said, never dropped silently.
    if (this.#overRateTimer) { clearTimeout(this.#overRateTimer); this.#overRateTimer = null; }
    for (const held of this.#overRateQueue.splice(0)) this.#reportUndelivered(held.id, 'over-rate', held.to);
    this.#sentFrames.clear();
    // Reject any in-flight push-control acks; their reply will never arrive.
    while (this.#pendingPushAcks.length > 0) {
      const h = this.#pendingPushAcks[0];
      h.reject(new Error('Relay: transport disconnected before ack'));
    }
    // DISCONNECT MEANS CLOSED: resolve once the socket's close has completed, not when it has merely started. Until the
    // relay has processed the close, this socket is still a holder of every address it registered, and a frame for one
    // of them can be handed to a device that has stopped reading. Bounded, so a dead network never hangs a shutdown.
    const ws = this.#ws;
    this.#ws = null;
    if (ws && ws.readyState !== 3) {
      await new Promise((resolve) => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, CLOSE_WAIT_MS);
        try { ws.addEventListener ? ws.addEventListener('close', done, { once: true }) : ws.once?.('close', done); } catch { done(); }
        try { ws.close(); } catch { done(); }
      });
    }
    this.emit('disconnect');
  }

  async _put(to, envelope, sendMeta = undefined) {
    // A refused relay is a permanent verdict, so say so now rather than after the 5s timeout below:
    // waiting would read as "the network is slow" for something that is never going to happen.
    if (this.#unprovenRelay) {
      throw new Error(`Relay: ${this.#relayUrl} refused — it does not demand proof of address possession.`);
    }
    // Wait until registered, but fail fast if the relay is unreachable.
    await Promise.race([
      this.#connectPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Relay: not connected')), 5_000)
      ),
    ]);
    // Topic-aware offline queueing (Phase 7 step 4): if the envelope was
    // built via `publishOneWay`, lift its `_topic` into the wire frame so
    // the relay can bucket the offline buffer per-(addr, topic). Other
    // envelopes go through the legacy per-addr FIFO bucket.
    // A frame sent AS an alias goes out only once the relay has acked that alias on THIS socket. Without this,
    // a message held while the socket was closed flushed at open ahead of the alias's replayed bind, and the
    // relay refused it as an unregistered sender — silently for the sender (the enrol walk, 2026-09-16).
    await this.#awaitSenderBound(envelope);
    await this.#paced(to, envelope, sendMeta?.background === true);
  }

  /** A token from the own bucket, or false (refilled by the time since the last look). */
  #takeToken() {
    const p = this.#pace; const now = Date.now();
    p.tokens = Math.min(p.burst, p.tokens + ((now - (p.at || now)) * p.perSec) / 1000);
    p.at = now;
    if (p.tokens >= 1) { p.tokens -= 1; return true; }
    return false;
  }

  /**
   * Write a `send` frame now when the bucket has a token and nothing waits before it; else wait in its class. Resolves
   * when the frame is written (a caller that awaits a send is paced with it), rejects when the write throws.
   */
  #paced(to, envelope, background) {
    if (!this.#waitingForeground.length && !this.#waitingBackground.length && this.#takeToken()) {
      this.#writeSend(to, envelope, 1);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      (background ? this.#waitingBackground : this.#waitingForeground).push({ to, envelope, resolve, reject });
      this.#schedulePace();
    });
  }

  #schedulePace() {
    if (this.#paceTimer || this.#stopped) return;
    const p = this.#pace;
    const wait = p.tokens >= 1 ? 0 : Math.ceil(((1 - p.tokens) * 1000) / p.perSec);
    this.#paceTimer = setTimeout(() => this.#drainPaced(), wait);
  }

  /** Everything waiting for a token is refused with the error a send made while offline gets (`_put`'s own). */
  #refusePaced() {
    if (this.#paceTimer) { clearTimeout(this.#paceTimer); this.#paceTimer = null; }
    const waiting = [...this.#waitingForeground.splice(0), ...this.#waitingBackground.splice(0)];
    for (const w of waiting) { try { w.reject(new Error('Relay: not connected')); } catch { /* the caller is gone */ } }
  }

  /** Send what waits as tokens allow: a person's sends first, then the background; in order within each. */
  #drainPaced() {
    this.#paceTimer = null;
    if (this.#stopped || !this.connected) { this.#refusePaced(); return; }
    while ((this.#waitingForeground.length || this.#waitingBackground.length) && this.#takeToken()) {
      const w = this.#waitingForeground.length ? this.#waitingForeground.shift() : this.#waitingBackground.shift();
      try { this.#writeSend(w.to, w.envelope, 1); w.resolve(); } catch (err) { w.reject(err); }
    }
    if (this.#waitingForeground.length || this.#waitingBackground.length) this.#schedulePace();
  }

  /** A frame sent AS an alias waits for that alias's ack on this socket (see `_put`). */
  async #awaitSenderBound(envelope) {
    const from = envelope?._from;
    if (typeof from === 'string' && from !== this.address && this.#signers.has(from) && !this.#bound.has(from)) {
      const t0 = Date.now();
      await this.#ensureBound(from);
      const waited = Date.now() - t0;
      if (waited > BIND_WAIT_WARN_MS) {
        const lost = this.#unboundWhy.get(from);
        console.warn(`[relay] a send as ${from.slice(0, 8)}… waited ${waited} ms for its bind on this socket`
          + (lost ? ` (unbound by ${lost.why} ${t0 - lost.at} ms before the send)` : ' (never bound on this socket)'));
      }
    }
  }

  /** Write one `send` frame, and keep it a while by its envelope id: the relay may refuse it as over-rate. */
  #writeSend(to, envelope, attempts, { firstAt = null, closeResent = false } = {}) {
    const frame = { type: 'send', to, envelope };
    if (envelope._topic) frame.topic = envelope._topic;
    this.#ws.send(JSON.stringify(frame));
    const id = envelope?._id;
    if (typeof id !== 'string' || !id) return;
    const now = Date.now();
    this.#sentFrames.delete(id);
    this.#sentFrames.set(id, { to, envelope, at: now, attempts, firstAt: firstAt ?? now, closeResent });
    // the oldest first: past the keep window, or over the count
    for (const [k, v] of this.#sentFrames) {
      if (now - v.at <= Number(OVER_RATE_KEEP_MS) && this.#sentFrames.size <= Number(OVER_RATE_KEEP_MAX)) break;
      this.#sentFrames.delete(k);
    }
  }

  /**
   * The relay refused the frame with envelope id `id` as over-rate. Kept → queued for a paced re-send, unless it has
   * had its attempts; not kept (or out of attempts) → the give-up path is told, as for the relay's `undelivered`.
   */
  #onOverRate(id) {
    const kept = this.#sentFrames.get(id);
    this.#sentFrames.delete(id);
    if (!kept || kept.attempts >= this.#overRate.maxAttempts) { this.#reportUndelivered(id, 'over-rate', kept?.to ?? null); return; }
    if (this.#overRateQueue.some((h) => h.id === id)) return;
    this.#hold({ id, ...kept });
  }

  /** Queue a frame for its paced re-send: given up and said when it is already too old or the queue is full. */
  #hold(held) {
    if (this.#tooOld(held)) { this.#reportUndelivered(held.id, 'over-rate-too-old', held.to); return; }
    if (this.#overRateQueue.length >= this.#overRate.maxQueued) { this.#reportUndelivered(held.id, 'over-rate-queue-full', held.to); return; }
    this.#overRateQueue.push(held);
    if (!this.#overRateTimer && !this.#overRateBusy) this.#overRateTimer = setTimeout(() => this.#resendOne(), this.#overRate.delayMs);
  }

  /** Too old to be taken: its signed `_ts` (else its first write) is past the age limit, under the replay window. */
  #tooOld(held) {
    const ts = Number(held?.envelope?._ts);
    const made = Number.isFinite(ts) && ts > 0 ? ts : Number(held?.firstAt ?? Date.now());
    return Date.now() - made > this.#overRate.maxAgeMs;
  }

  /** Give up, and say, every waiting frame that is too old to be taken (also while the socket is down). */
  #dropTooOld() {
    const keep = [];
    for (const held of this.#overRateQueue.splice(0)) {
      if (this.#tooOld(held)) this.#reportUndelivered(held.id, 'over-rate-too-old', held.to);
      else keep.push(held);
    }
    this.#overRateQueue.push(...keep);
  }

  /**
   * The socket closed: a frame written on it just before, with no answer yet, may have lost its refusal with it. Each
   * is sent once more on the next socket (a receiver drops a copy it already holds by its id); a frame already sent
   * again for a close is not, so a flapping socket cannot repeat it. What was kept for the old socket is let go.
   */
  #holdUnansweredAtClose() {
    const now = Date.now();
    for (const [id, kept] of this.#sentFrames) {
      if (now - kept.at > this.#overRate.unansweredAtCloseMs || kept.closeResent) continue;
      if (this.#overRateQueue.some((h) => h.id === id)) continue;
      this.#hold({ id, ...kept, closeResent: true });
    }
    this.#sentFrames.clear();
  }

  /** Send the oldest refused frame again; the next one follows after the pace's interval. Never faster, never more. */
  async #resendOne() {
    this.#overRateTimer = null;
    if (this.#stopped) return;
    this.#dropTooOld();
    const held = this.#overRateQueue[0];
    if (!held) return;
    if (!this.connected) {   // no socket: nothing is sent; look again after the first wait
      this.#overRateTimer = setTimeout(() => this.#resendOne(), this.#overRate.delayMs);
      return;
    }
    this.#overRateQueue.shift();
    this.#overRateBusy = true;
    try {
      await this.#awaitSenderBound(held.envelope);
      this.#writeSend(held.to, held.envelope, held.attempts + 1, { firstAt: held.firstAt, closeResent: held.closeResent });
    } catch {
      this.#reportUndelivered(held.id, 'over-rate', held.to);
    } finally {
      this.#overRateBusy = false;
    }
    if (this.#overRateQueue.length && !this.#overRateTimer && !this.#stopped) {
      this.#overRateTimer = setTimeout(() => this.#resendOne(), 1000 / this.#overRate.perSec);
    }
  }

  /**
   * Tell the give-up path the relay will not deliver the envelope `envelopeId`. The app's delivery state is keyed by the
   * message id inside the payload — so report that one when this transport sent it, else the envelope id (an id-less
   * payload is one the app never tracked).
   */
  #reportUndelivered(envelopeId, reason, to = null) {
    const sent = this.sentEnvelopeFor(envelopeId);
    const appId = sent?.msgId ?? null;
    try { this.onUndelivered?.({ msgId: appId ?? envelopeId, envelopeId, reason, to: sent?.to ?? to ?? null, subtype: sent?.subtype ?? null }); }
    catch { /* a consumer that throws must not take the socket down */ }
  }

  /**
   * Register a device push token with the relay so the relay can wake the
   * device when an envelope is queued for this address while offline.
   * Requires the relay to have been started with `pushSender` configured.
   *
   * @param {object} args
   * @param {string} args.token        Expo / APNs / FCM token from `MobilePushBridge.register()`.
   * @param {string} [args.platform]   'ios' | 'android' | 'web' (informational).
   * @returns {Promise<void>}          resolves on `push-token-registered` ack;
   *                                   rejects on timeout (5s) or transport error.
   */
  async registerPushToken({ token, platform } = {}) {
    if (!token || typeof token !== 'string') {
      throw new TypeError('RelayTransport.registerPushToken: token required');
    }
    await this.#awaitConnected();
    return this.#sendAndAwaitAck(
      { type: 'register-push-token', token, platform },
      'push-token-registered',
    );
  }

  /**
   * Unregister this address's push token.  Idempotent.
   *
   * @returns {Promise<void>}
   */
  async unregisterPushToken() {
    await this.#awaitConnected();
    return this.#sendAndAwaitAck(
      { type: 'unregister-push-token' },
      'push-token-unregistered',
    );
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /** Ask to register `address`; the relay answers with a challenge, never with a registration. */
  #sendRegister(address, primary = false) {
    this.#asked.add(address);
    // `serves` rides only the socket's OWN address — an alias never opts the node into anything
    const serves = address === this.address && this.#serves.length ? { serves: this.#serves } : {};
    const standby = !primary && this.#standbyFlags.get(address) === true ? { standby: true } : {};
    this.#ws.send(JSON.stringify({ type: 'register', address, ...(primary ? { primary: true } : {}), ...standby, ...serves }));
  }

  /** Sign the relay's nonce for `address` and send the proof. Silent about addresses we never asked for. */
  async #answerChallenge(ws, address, nonce) {
    if (!this.#asked.has(address)) return;               // we did not ask to register this
    let proof;
    try {
      proof = await this.#signFor(address, nonce);
    } catch (err) {
      this.emit('error', new Error(`Relay: cannot prove ${address.slice(0, 12)}… — ${err?.message ?? err}`));
      return;
    }
    if (!proof) {
      // No key for this address on this device. Nothing to fall back to: an address we cannot prove
      // is an address we cannot have, and pretending otherwise is what the whole rule removes.
      this.emit('error', new Error(`Relay: no signer for ${address.slice(0, 12)}… — not registered`));
      return;
    }
    this.#proved.add(address);
    this.#proofsInFlight.set(address, (this.#proofsInFlight.get(address) ?? 0) + 1);
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'register-proof', address, nonce, proof, relay: relayNameOf(this.#relayUrl) }));
  }

  /**
   * Sign `message` as `address`: the transport's own identity for the primary, the caller's
   * per-alias `sign` for anything else (they hold a different key per circle, and only the caller
   * knows which). Returns null when this device cannot sign for that address at all.
   */
  async #signFor(address, nonce) {
    if (address === this.address && this.identity) {
      return signAddressPossession(this.identity, address, nonce, relayNameOf(this.#relayUrl));
    }
    const sign = this.#signers.get(address);
    if (typeof sign !== 'function') return null;
    // The adapter builds the message; the caller only holds the key. See `Transport.addAddress`.
    const sig = await sign(addressPossessionMessage(address, nonce, relayNameOf(this.#relayUrl)));
    return typeof sig === 'string' ? sig : (sig ? b64encode(sig) : null);
  }

  /**
   * The relay registered us without ever demanding proof. Refuse it: report by name, drop the
   * socket, and do NOT reconnect — this is not a transient failure but a statement about what that
   * relay checks, and reconnecting would just re-accept it. Deliberately no fallback path.
   */
  #failUnprovenRelay(address) {
    this.#unprovenRelay = true;
    this.#stopped = true;
    const err = new Error(
      `Relay: refused — ${this.#relayUrl} acknowledged registration of ${String(address).slice(0, 12)}… `
      + 'without demanding proof of possession. A relay that does not ask lets anyone claim any '
      + 'address, so we do not register there.',
    );
    this.emit('error', err);
    this.#settleAllBinds(err);
    try { this.#ws?.close(); } catch { /* it may already be gone */ }
    this.#ws = null;
    this.emit('disconnect');
  }

  /** Block until registered with the relay, or fail fast if unreachable (or refused). */
  async #awaitConnected() {
    if (this.#unprovenRelay) {
      throw new Error(`Relay: ${this.#relayUrl} refused — it does not demand proof of address possession.`);
    }
    await Promise.race([
      this.#connectPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Relay: not connected')), 5_000)
      ),
    ]);
  }

  /** Send a control frame and resolve when the matching ack lands (or timeout). */
  #sendAndAwaitAck(frame, ackType) {
    return new Promise((resolve, reject) => {
      const handler = { ackType };
      const cleanup = () => {
        const idx = this.#pendingPushAcks.indexOf(handler);
        if (idx >= 0) this.#pendingPushAcks.splice(idx, 1);
        clearTimeout(handler.timer);
      };
      handler.resolve = () => { cleanup(); resolve(); };
      handler.reject  = (e) => { cleanup(); reject(e); };
      handler.timer   = setTimeout(
        () => handler.reject(new Error(`${frame.type}: relay did not acknowledge within ${PUSH_ACK_TIMEOUT_MS}ms`)),
        PUSH_ACK_TIMEOUT_MS,
      );
      this.#pendingPushAcks.push(handler);
      try {
        this.#ws.send(JSON.stringify(frame));
      } catch (err) {
        handler.reject(err);
      }
    });
  }

  /** Emit peer-discovered once per address (skip self and duplicates). */
  #discoverPeer(addr) {
    if (!addr || addr === this.address) return;
    if (this.#knownPeers.has(addr)) return;
    this.#knownPeers.add(addr);
    this.emit('peer-discovered', addr);
  }

  /**
   * Drop this peer from our dedup cache and ask the relay for a fresh peer
   * list.  If the peer is still registered, they'll be re-emitted as
   * peer-discovered and the app can hello them again.
   */
  forgetPeer(address) {
    this.#knownPeers.delete(address);
    if (this.#peerDiscovery && this.#ws?.readyState === 1) {
      try { this.#ws.send(JSON.stringify({ type: 'peer-list' })); } catch {}
    }
  }

  /** Reset #connectPromise to a pending promise immediately (before the reconnect timer). */
  #resetConnectPromise() {
    this.#connectPromise = new Promise(resolve => { this.#connectResolve = resolve; });
  }

  async #openSocket() {
    let WS;
    if (typeof WebSocket !== 'undefined') {
      WS = WebSocket;
    } else {
      try {
        const mod = await import('ws');
        WS = mod.default ?? mod;
      } catch {
        throw new Error('ws package not found. Run: npm install ws');
      }
    }

    // If there's no pending connect promise, create one now.
    if (!this.#connectResolve) this.#resetConnectPromise();

    const ws = new WS(this.#relayUrl);
    this.#ws = ws;

    ws.onopen = () => {
      this.#backoffMs = 1_000;
      // A new socket has proved nothing, and the relay behind it has demanded nothing — the audit
      // starts again from zero on every connect, or a proof from the last socket would excuse this
      // one.
      this.#asked.clear();
      this.#proved.clear();
      this.#proofsInFlight.clear();
      for (const a of this.#bound) this.#unboundWhy.set(a, { why: 'reconnect', at: Date.now() });
      this.#bound.clear();
      this.#primaryAcked = false;
      this.#sendRegister(this.address, this.#primaryDevice() === true);
      // Replay every alias — a new socket knows nothing about the last one.
      this._rebindAddresses();
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = parseUntrustedJson(event.data); } catch (err) { this._frameRefused(err); return; }

      // The relay demands proof: sign ITS nonce with the key behind the address we are claiming.
      // Note what the relay supplies and what it does not — it hands us a nonce, and we build the
      // message ourselves, so registration cannot be turned into a signature over content of the
      // relay's choosing.
      if (msg.type === 'challenge' && msg.address && msg.nonce) {
        this.#answerChallenge(ws, msg.address, msg.nonce);
        return;
      }

      if (msg.type === 'registered') {
        // The audit. `address` is absent on a relay old enough not to say which registration it is
        // acking — which is also a relay old enough not to have challenged us, so it fails here.
        const address = msg.address ?? this.address;
        // Each ack answers ONE proof this socket sent for that address — a re-registration in flight (a moved primary
        // flag, a boot re-announce: several of a person's devices hold one circle address now) never un-proves the
        // earlier one, and an ack with no proof outstanding is still the relay that did not demand one.
        const outstanding = this.#proofsInFlight.get(address) ?? 0;
        if (!this.#proved.has(address) || outstanding < 1) {
          this.#failUnprovenRelay(address);
          return;
        }
        this.#proofsInFlight.set(address, outstanding - 1);
        // An alias landed: release whoever is awaiting `addAddress` for it. The connect promise
        // belongs to the primary, so an alias never resolves that one.
        this.#bound.add(address);
        this.#settleBind(address);
        if (address !== this.address) return;
        // the socket's own address, acked: 'connect' once per socket (a re-register with a moved primary flag acks again)
        if (this.#primaryAcked) return;
        this.#primaryAcked = true;
        this.emit('connect', { address: this.address });
        const res = this.#connectResolve;
        this.#connectResolve = null;
        res?.();
        return;
      }
      // peer-joined: individual join event (forward-compat, not sent by current relay)
      // Both peer frames are taken only when this client turned discovery on (`peerDiscovery`); otherwise dropped.
      if (msg.type === 'peer-joined' && msg.address) {
        if (this.#peerDiscovery) this.#discoverPeer(msg.address);
        return;
      }
      // peer-list: full broadcast sent by relay on every connect/disconnect
      if (msg.type === 'peer-list' && Array.isArray(msg.peers)) {
        if (this.#peerDiscovery) for (const addr of msg.peers) this.#discoverPeer(addr);
        return;
      }
      if (msg.type === 'message' && msg.envelope) {
        this._receive(msg.envelope);
        return;
      }
      // Push-control acks (E2c).  Resolve the oldest pending handler whose
      // ackType matches; non-matching handlers stay in the queue.
      if (msg.type === 'push-token-registered' || msg.type === 'push-token-unregistered') {
        const idx = this.#pendingPushAcks.findIndex((h) => h.ackType === msg.type);
        if (idx >= 0) this.#pendingPushAcks[idx].resolve();
        return;
      }
      // The relay gave up on a message we sent: it was queued for an offline peer and the TTL or a cap
      // ended it. Surfaced as a REPORT, not an error — the send succeeded, the delivery did not.
      if (msg.type === 'undelivered' && msg.id) {
        // The frame names the ENVELOPE (the only id the relay ever sees). The app's delivery state is keyed by
        // the message id inside the payload — so report that one when this transport sent it, else the envelope
        // id (an id-less payload is one the app never tracked). Until 2026-09-16 the envelope id was reported
        // as `msgId`, and both shells' give-up consumers marked a message that did not exist: a message the
        // relay threw away after 24 h kept looking fine.
        // who it was for and what kind it was: this transport's own memory of its send (the relay's frame names neither)
        this.#reportUndelivered(msg.id, msg.reason ?? 'unknown');
        return;
      }
      // An over-rate refusal that names its frame: sent again, paced (`#onOverRate`). One that names none (an older
      // relay) is the generic error below, as before.
      if (msg.type === 'error' && msg.message === 'OVER_RATE' && typeof msg.id === 'string' && msg.id) {
        this.#onOverRate(msg.id);
        return;
      }
      if (msg.type === 'error') {
        // A refused REGISTRATION is the answer to an outstanding `addAddress`, so end that wait now
        // rather than letting it run to its timeout — "refused" and "no answer" are different facts
        // and the caller is owed the first one. The relay names the address it refused; a relay that
        // does not is taken to have refused whatever we last asked for, which is the safe reading
        // (it can only ever report a bind as failed that might later succeed, never the reverse).
        const refusal = new Error(`Relay: ${msg.message}`);
        // A refusal of ONE FRAME (an unregistered sender, a rate or quota cap) says nothing about a registration in
        // flight — settling the pending binds on it made a bind fail because a send was refused (2026-09-16).
        const perFrame = PER_FRAME_REFUSALS.has(String(msg.message ?? ''));
        if (typeof msg.address === 'string' && this.#pendingBinds.has(msg.address)) {
          this.#settleBind(msg.address, refusal);
        } else if (!msg.address && !perFrame && this.#pendingBinds.size > 0) {
          this.#settleAllBinds(refusal);
        }
        // If a push-control call is in flight, reject it with the relay's
        // message — that gives clear feedback to register/unregisterPushToken
        // callers.  Otherwise surface as a generic transport error.
        const pendingPush = this.#pendingPushAcks[0];
        if (pendingPush && /push|register/i.test(msg.message ?? '')) {
          pendingPush.reject(new Error(`Relay: ${msg.message}`));
          return;
        }
        this.emit('error', refusal);
      }
    };

    ws.onerror = (err) => {
      const e = err?.error ?? err;
      this.emit('error', e instanceof Error ? e : new Error('WebSocket error'));
    };

    ws.onclose = () => {
      // Anything waiting on an ack from THIS socket will never get one; the alias stays in the
      // replay set and is re-proved on the next connect, but the caller is told now.
      this.#settleAllBinds(new Error('Relay: socket closed before the address was acknowledged'));
      // …and a frame waiting for a token on it ends as a send made while offline does: refused, so each caller's own
      // hold or retry decides — never written later on another socket behind the caller's back
      this.#refusePaced();
      if (this.#stopped) return;
      this.#holdUnansweredAtClose();
      // Immediately reset the connect promise so any concurrent _put calls will
      // wait for the new connection rather than using the stale resolved promise.
      this.#resetConnectPromise();
      this.#backoffMs = Math.min(this.#backoffMs * 2, MAX_BACKOFF_MS);
      setTimeout(() => {
        if (!this.#stopped) this.#openSocket().catch(() => {});
      }, this.#backoffMs);
    };

    return this.#connectPromise;
  }
}
