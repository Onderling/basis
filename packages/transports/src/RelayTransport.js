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
  Transport, addressPossessionMessage, signAddressPossession, b64encode,
} from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

// Parameter register (#36) — reconnect backoff ceiling + push-ack timeout (scope:device, kind:internal).
const MAX_BACKOFF_MS = param({ key: 'transports.maxBackoffMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });
const PUSH_ACK_TIMEOUT_MS = param({ key: 'transports.pushAckTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 5_000 });

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

  /**
   * @param {object} opts
   * @param {string}  opts.relayUrl  — ws:// or wss:// relay URL
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   */
  constructor(opts) {
    if (!opts?.relayUrl)  throw new Error('RelayTransport requires relayUrl');
    if (!opts?.identity)  throw new Error('RelayTransport requires identity');
    super({ address: opts.identity.pubKey, identity: opts.identity });
    this.#relayUrl = opts.relayUrl;
    // Called when the relay reports it gave up on a message we sent (see the 'undelivered' frame below).
    // A plain assignable property rather than an event emitter — this class has no emitter, and one
    // consumer is all this has ever needed.
    this.onUndelivered = typeof opts.onUndelivered === 'function' ? opts.onUndelivered : null;
  }

  // G13 — extra addresses. The alias SET, the public API and the replay rule live in the base `Transport`
  // (one implementation for every adapter); this only says how a relay binds one: another `register` frame
  // on the same socket, which the relay accepts (step A).
  get supportsAliases() { return true; }

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
    if (!this.connected) return;      // replayed by `_rebindAddresses()` on the next connect
    this.#sendRegister(address);
    await this.#awaitBound(address);
  }

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
    this.#asked.delete(address);
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
    // Reject any in-flight push-control acks; their reply will never arrive.
    while (this.#pendingPushAcks.length > 0) {
      const h = this.#pendingPushAcks[0];
      h.reject(new Error('Relay: transport disconnected before ack'));
    }
    this.#ws?.close();
    this.#ws = null;
    this.emit('disconnect');
  }

  async _put(to, envelope) {
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
    const frame = { type: 'send', to, envelope };
    if (envelope._topic) frame.topic = envelope._topic;
    this.#ws.send(JSON.stringify(frame));
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
  #sendRegister(address) {
    this.#asked.add(address);
    this.#proved.delete(address);
    this.#ws.send(JSON.stringify({ type: 'register', address }));
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
    if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'register-proof', address, nonce, proof }));
  }

  /**
   * Sign `message` as `address`: the transport's own identity for the primary, the caller's
   * per-alias `sign` for anything else (they hold a different key per circle, and only the caller
   * knows which). Returns null when this device cannot sign for that address at all.
   */
  async #signFor(address, nonce) {
    if (address === this.address && this.identity) {
      return signAddressPossession(this.identity, address, nonce);
    }
    const sign = this.#signers.get(address);
    if (typeof sign !== 'function') return null;
    // The adapter builds the message; the caller only holds the key. See `Transport.addAddress`.
    const sig = await sign(addressPossessionMessage(address, nonce));
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
    if (this.#ws?.readyState === 1) {
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
      this.#sendRegister(this.address);
      // Replay every alias — a new socket knows nothing about the last one.
      this._rebindAddresses();
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

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
        if (!this.#proved.has(address)) {
          this.#failUnprovenRelay(address);
          return;
        }
        // An alias landed: release whoever is awaiting `addAddress` for it. The connect promise
        // belongs to the primary, so an alias never resolves that one.
        this.#settleBind(address);
        if (address !== this.address) return;
        this.emit('connect', { address: this.address });
        const res = this.#connectResolve;
        this.#connectResolve = null;
        res?.();
        return;
      }
      // peer-joined: individual join event (forward-compat, not sent by current relay)
      if (msg.type === 'peer-joined' && msg.address) {
        this.#discoverPeer(msg.address);
        return;
      }
      // peer-list: full broadcast sent by relay on every connect/disconnect
      if (msg.type === 'peer-list' && Array.isArray(msg.peers)) {
        for (const addr of msg.peers) this.#discoverPeer(addr);
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
        try { this.onUndelivered?.({ msgId: msg.id, reason: msg.reason ?? 'unknown' }); }
        catch { /* a consumer that throws must not take the socket down */ }
        return;
      }
      if (msg.type === 'error') {
        // A refused REGISTRATION is the answer to an outstanding `addAddress`, so end that wait now
        // rather than letting it run to its timeout — "refused" and "no answer" are different facts
        // and the caller is owed the first one. The relay names the address it refused; a relay that
        // does not is taken to have refused whatever we last asked for, which is the safe reading
        // (it can only ever report a bind as failed that might later succeed, never the reverse).
        const refusal = new Error(`Relay: ${msg.message}`);
        if (typeof msg.address === 'string' && this.#pendingBinds.has(msg.address)) {
          this.#settleBind(msg.address, refusal);
        } else if (!msg.address && this.#pendingBinds.size > 0) {
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
      if (this.#stopped) return;
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
