/**
 * WsServerTransport — WebSocket relay server.
 *
 * Acts as the relay's own Transport AND as a message broker for connected peers.
 *
 * Protocol (matches RelayTransport client):
 *   Client → Server: { type: 'register', address: '<pubKey>' }
 *   Server → Client: { type: 'challenge', address, nonce }
 *   Client → Server: { type: 'register-proof', address, nonce, proof }
 *   Server → Client: { type: 'registered', address }
 *   Client → Server: { type: 'send', to: '<address>', envelope: {...} }
 *   Server → Client: { type: 'message', envelope: {...} }
 *   Server → Client: { type: 'error', message: '<reason>' }
 *
 * Routing:
 *   _to === relay's own address  → _receive() (dispatch to RelayAgent)
 *   _to === connected peer       → forward to that peer's WebSocket
 *   _to === offline peer         → buffer in queue (up to offlineQueueTtl ms)
 *
 * WebRTC signaling envelopes are forwarded as-is (no special handling needed).
 *
 * Proof of possession on register (2026-07-31, DESIGN-boundary-authentication §7 — Decision 3):
 * registration here is CHALLENGE-FIRST too, and for the same reason. This broker speaks the same
 * wire protocol as `server.js`, so leaving it unproven would have left a second relay that a
 * compliant client must refuse to talk to — and the check costs it nothing it lacks: verifying a
 * proof needs no identity of the verifier's own, only the address, because the address IS the
 * public key. It has no `acceptedGroups` and no group proof (that is operator policy `server.js`
 * carries and this one does not), so the ONLY thing register asks here is "do you hold this key".
 *
 * Sender binding (2026-07-31): a `send` frame whose `envelope._from` is an address this socket has not
 * registered is refused with `SENDER_NOT_REGISTERED` and not forwarded — the same rule
 * (`senderVerdict`, from `@onderling/core`) that `server.js` and the NKN transports ask, with this
 * broker's own answer to "who is this connection authenticated to speak as?". It was documented as
 * hygiene rather than a defence, because a socket could simply register the victim's address first.
 * **That premise is gone as of the proof above**: an address on this socket's registered set is one
 * it proved, so the binding now says something about a key rather than about a claim.
 */
import { WebSocketServer } from 'ws';

// Transport is a peer dependency resolved from @onderling/core.
import {
  Transport, senderVerdict,
  newAddressChallenge, verifyAddressPossession, ADDRESS_CHALLENGE_TTL_MS,
} from '@onderling/core';

import { ForwardQueue } from './ForwardQueue.js';

export class WsServerTransport extends Transport {
  #wss  = null;
  #port;

  // Map<address, WebSocket>
  #clients = new Map();

  // The single relay hold-and-forward owner (shared with server.js). This
  // broker's shape: one bucket per address, no topics, no caps, expiry
  // purged lazily on enqueue + filtered again at drain.
  #forward;

  /**
   * @param {object} opts
   * @param {number} [opts.port=0]                — 0 = OS-assigned port
   * @param {string} opts.address                 — relay's own pubKey / address
   * @param {number} [opts.offlineQueueTtl=300000] — ms to buffer for offline peers
   */
  constructor({ port = 0, address, offlineQueueTtl = 300_000 } = {}) {
    if (!address) throw new Error('WsServerTransport requires address');
    super({ address });
    this.#port    = port;
    this.#forward = new ForwardQueue({
      ttlMs:        offlineQueueTtl,
      topicAware:   false,
      evictOnWrite: true,
    });
  }

  /** Actual bound port (available after start()). */
  get port() { return this.#wss?.address()?.port ?? null; }

  /** Addresses of currently connected peers (excludes the relay itself). */
  getConnectedPeers() { return [...this.#clients.keys()]; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    this.#wss = new WebSocketServer({ port: this.#port });

    await new Promise((resolve, reject) => {
      this.#wss.once('listening', resolve);
      this.#wss.once('error', reject);
    });

    this.#wss.on('connection', ws => this.#onConnection(ws));
  }

  async stop() {
    for (const ws of this.#clients.values()) ws.close();
    this.#clients.clear();
    await new Promise(resolve => this.#wss.close(resolve));
    this.#wss = null;
  }

  // ── Transport._put — called when RelayAgent sends a message ──────────────

  async _put(to, envelope) {
    if (to === this.address) {
      // Self-delivery: message addressed to the relay agent itself.
      this._receive(envelope);
      return;
    }
    this.#route(to, envelope);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  #onConnection(ws) {
    let peerAddress = null;
    // Every address this socket has registered. `peerAddress` stays the socket's PRIMARY identity (the
    // most recent registration, used for the peer-connected/disconnected events); this set is what sender
    // binding is asked about, because one socket may legitimately own several addresses — a device
    // presents a different address per circle, the same shape `server.js` already carries.
    const registeredAddresses = new Set();
    /** nonce → { address, expiresAt } — challenges issued on THIS socket and not yet answered. */
    const openChallenges = new Map();

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // Register, step 1: ask. Nothing is registered here — `#clients.set` is unreachable from
      // this branch, which is what makes "no unproven address is ever routed to" structural.
      if (msg.type === 'register') {
        if (!msg.address) return;
        for (const [n, c] of openChallenges) if (c.expiresAt <= Date.now()) openChallenges.delete(n);
        const nonce = newAddressChallenge();
        openChallenges.set(nonce, { address: msg.address, expiresAt: Date.now() + ADDRESS_CHALLENGE_TTL_MS });
        ws.send(JSON.stringify({ type: 'challenge', address: msg.address, nonce }));
        return;
      }

      // Register, step 2: prove. Verified against the address itself.
      if (msg.type === 'register-proof') {
        const { address, nonce, proof } = msg;
        const challenge = typeof nonce === 'string' ? openChallenges.get(nonce) : null;
        if (!challenge || challenge.address !== address) {
          ws.send(JSON.stringify({ type: 'error', message: 'NO_CHALLENGE', address }));
          return;
        }
        openChallenges.delete(nonce);                         // single use, spent before verifying
        if (Date.now() > challenge.expiresAt) {
          ws.send(JSON.stringify({ type: 'error', message: 'CHALLENGE_EXPIRED', address }));
          return;
        }
        if (!verifyAddressPossession({ address, nonce, proof })) {
          ws.send(JSON.stringify({ type: 'error', message: 'PROOF_INVALID', address }));
          return;
        }

        peerAddress = address;
        registeredAddresses.add(peerAddress);
        this.#clients.set(peerAddress, ws);
        ws.send(JSON.stringify({ type: 'registered', address: peerAddress }));
        this.#forward.drain(peerAddress, ws, { evictFirst: true });
        this.emit('peer-connected', peerAddress);
        // Notify all other connected clients that a new peer joined
        const joined = JSON.stringify({ type: 'peer-joined', address: peerAddress });
        for (const [addr, client] of this.#clients) {
          if (addr !== peerAddress && client.readyState === 1) client.send(joined);
        }
        return;
      }

      if (msg.type === 'send' && msg.envelope) {
        const to = msg.to ?? msg.envelope?._to;
        if (!to) return;

        // Sender binding — one shared rule, this broker's port: the addresses this socket registered. An
        // EMPTY set is a real answer ("registered as nobody"), so a claim from a socket that never
        // registered is refused rather than passing through the unchecked path. A frame with no `_from`
        // is forwarded (`no-claimed-sender`) — bare payload objects are legitimate wire traffic here, and
        // an envelope without a sender is useless to an impersonator. Refuse the FRAME, keep the socket:
        // one socket owns many addresses, so a mis-timed frame must not take the others down.
        // See the header for why this is hygiene rather than a defence on this particular broker.
        const verdict = senderVerdict(null, msg.envelope, () => [...registeredAddresses]);
        if (!verdict.ok) {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ type: 'error', message: 'SENDER_NOT_REGISTERED' }));
          }
          return;
        }

        if (to === this.address) {
          // Message addressed to the relay itself — dispatch to RelayAgent.
          this._receive(msg.envelope);
        } else {
          this.#route(to, msg.envelope, ws);
        }
        return;
      }
    });

    ws.on('close', () => {
      if (peerAddress) {
        this.#clients.delete(peerAddress);
        this.emit('peer-disconnected', peerAddress);
      }
    });

    ws.on('error', () => {
      if (peerAddress) this.#clients.delete(peerAddress);
    });
  }

  /**
   * Forward an envelope to `to`, buffering for offline peers via the shared
   * ForwardQueue. On a buffered delivery, notify the sender (`{type:'queued'}`)
   * — the one wire behaviour unique to this broker, kept here because it needs
   * the sender socket.
   */
  #route(to, envelope, senderWs = null) {
    const outcome = this.#forward.deliverOrEnqueue(to, envelope, {
      socket: this.#clients.get(to) ?? null,
    });
    if (outcome === 'queued' && senderWs && senderWs.readyState === 1) {
      senderWs.send(JSON.stringify({ type: 'queued', to }));
    }
  }
}
