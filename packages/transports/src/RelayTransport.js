/**
 * RelayTransport — WebSocket relay server transport.
 *
 * The relay server is a simple message broker: agents register by address,
 * and the relay forwards envelopes to the correct connected client.
 *
 * Protocol (JSON over WebSocket):
 *   Client → Relay: { type: 'register', address: '<pubKey>' }
 *   Relay  → Client: { type: 'registered' }
 *   Client → Relay: { type: 'send', to: '<address>', envelope: { ... } }
 *   Relay  → Client: { type: 'message', envelope: { ... } }
 *   Relay  → Client: { type: 'error', message: '<reason>' }
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
import { Transport } from '@onderling/core';

const MAX_BACKOFF_MS = 30_000;
const PUSH_ACK_TIMEOUT_MS = 5_000;

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
   * @param {object} opts
   * @param {string}  opts.relayUrl  — ws:// or wss:// relay URL
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   */
  constructor(opts) {
    if (!opts?.relayUrl)  throw new Error('RelayTransport requires relayUrl');
    if (!opts?.identity)  throw new Error('RelayTransport requires identity');
    super({ address: opts.identity.pubKey, identity: opts.identity });
    this.#relayUrl = opts.relayUrl;
  }

  // G13 — extra addresses. The alias SET, the public API and the replay rule live in the base `Transport`
  // (one implementation for every adapter); this only says how a relay binds one: another `register` frame
  // on the same socket, which the relay accepts (step A).
  get supportsAliases() { return true; }

  async _bindAddress(address) {
    if (!this.connected) return;      // replayed by `_rebindAddresses()` on the next connect
    this.#ws.send(JSON.stringify({ type: 'register', address }));
  }

  // A socket cannot un-register a single address today, so removal takes effect on the next reconnect —
  // the base class has already dropped it from the replay set, which is what makes that true.
  _unbindAddress(_address) {}

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

  /** Block until registered with the relay, or fail fast if unreachable. */
  async #awaitConnected() {
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
      ws.send(JSON.stringify({ type: 'register', address: this.address }));
      // Replay every alias — a new socket knows nothing about the last one.
      this._rebindAddresses();
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }

      if (msg.type === 'registered') {
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
      if (msg.type === 'error') {
        // If a push-control call is in flight, reject it with the relay's
        // message — that gives clear feedback to register/unregisterPushToken
        // callers.  Otherwise surface as a generic transport error.
        const pendingPush = this.#pendingPushAcks[0];
        if (pendingPush && /push|register/i.test(msg.message ?? '')) {
          pendingPush.reject(new Error(`Relay: ${msg.message}`));
          return;
        }
        this.emit('error', new Error(`Relay: ${msg.message}`));
      }
    };

    ws.onerror = (err) => {
      const e = err?.error ?? err;
      this.emit('error', e instanceof Error ? e : new Error('WebSocket error'));
    };

    ws.onclose = () => {
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
