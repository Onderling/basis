/**
 * MdnsTransport — local-network peer discovery + a TCP data channel, BACKEND-INJECTED.
 *
 * This file is the ROUTING layer and nothing else: it matches discovered peers to connections, keeps the
 * pubKey ↔ connectionId maps, applies the tiebreaker, and tracks discoverability. Every socket and every
 * DNS-SD call belongs to an injected backend, so the same routing runs over the Android native module and
 * over a Node implementation without a second copy of these rules.
 *
 * ── The wire contract (changing any of this breaks interop, silently) ────────────────────────────────────
 * Service type `_onderling._tcp.`, the agent's pubKey in a `pubKey` TXT attribute, plain TCP to the
 * advertised port, and a 4-byte big-endian length prefix per frame so each `MdnsDataReceived` carries
 * exactly one complete message — no reassembly here.
 *
 * **Connection tiebreaker:** when both peers discover each other at once, only the peer whose pubKey sorts
 * lexicographically LOWER initiates; the higher-key peer waits for the inbound connection. The initiator
 * sends a `_mdns_hello` frame immediately, and the two sides prove their keys to each other (the challenged
 * hello, below) before either keys the connection — a TXT record's pubKey and a hello's `_from` are claims.
 *
 * The failure mode this contract protects against is the nasty one: a mismatched implementation does not
 * error, it simply never sees the other side.
 *
 * ── Getting one ─────────────────────────────────────────────────────────────────────────────────────────
 * Do not construct this directly on a phone. `@onderling/react-native` exports a subclass with the Android
 * MdnsModule already injected (and the `isAvailable()` guard the mesh builder uses).
 */
import { Transport, DISCOVERABILITY, AgentIdentity } from '@onderling/core';
import { b64Encode, b64Decode }       from './utils/base64.js';

/**
 * THE HELLO IS PROVEN. A connection is keyed by a pubKey only when the far end has signed THIS side's nonce with that
 * key — a hello's `_from` and a TXT record's `pubKey` are claims, and keying on a claim let any device on the Wi-Fi
 * become another device's row and its route. Three frames, each side proving itself to the other:
 *   dialler → listener   { _mdns_hello: true, _from: D, nonce: nD }
 *   listener → dialler   { _mdns_challenge: true, _from: L, nonce: nL, sig: L.sign(proof(nD, L, D)) }
 *   dialler → listener   { _mdns_proof: true, sig: D.sign(proof(nL, D, L)) }
 * The dialler keys the connection on a verified challenge (and `_from` must be the key it dialled); the listener on a
 * verified proof. The message signed is built HERE, never taken from the far end. Part of the wire contract: a peer
 * on an older build is never keyed (both sides must ship this together).
 */
const HELLO_DOMAIN = 'onderling-mdns-hello-v1';
/**
 * The message one side signs to prove its key in the challenged hello — built here, never taken from the far end.
 * @param {string} nonce     the OTHER side's nonce
 * @param {string} prover    the pubKey doing the proving
 * @param {string} verifier  the pubKey it proves itself to
 * @returns {string}
 */
export const helloProof = (nonce, prover, verifier) => `${HELLO_DOMAIN}|${nonce}|${prover}|${verifier}`;
const HANDSHAKE_MS = 10_000;
function freshNonce() {
  const b = new Uint8Array(24);
  globalThis.crypto.getRandomValues(b);
  return b64Encode(b);
}
const sigB64 = (bytes) => b64Encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
function verifies(message, sig, pubKey) {
  try { return typeof sig === 'string' && typeof pubKey === 'string' && AgentIdentity.verify(message, sig, pubKey) === true; }
  catch { return false; }
}

/** The DNS-SD service type every Onderling device advertises and browses for. Part of the wire contract. */
export const SERVICE_TYPE = '_onderling';

/**
 * What a backend must provide. Named here so a second one has a checklist rather than an archaeology
 * exercise:
 *
 *   native.start(serviceType, serviceName, pubKey) -> Promise<port>    // advertise AND browse
 *   native.startAdvertising(serviceType, serviceName, pubKey) -> Promise<port>
 *   native.startDiscovery(serviceType)  -> Promise
 *   native.stopAdvertising()            -> Promise
 *   native.stopDiscovery()              -> Promise
 *   native.stop()                       -> Promise
 *   native.connect(host, port)          -> Promise<connectionId>
 *   native.send(connectionId, base64)   -> Promise
 *   native.close?.(connectionId)        -> Promise                     // optional
 *
 *   emitter.addListener(name, fn) -> { remove() }
 *     'MdnsServiceDiscovered'  { host, port, pubKey }
 *     'MdnsClientConnected'    { connectionId }
 *     'MdnsDataReceived'       { connectionId, data }   // STANDARD base64, not base64url
 *     'MdnsClientDisconnected' { connectionId }
 *     'MdnsError'              { message }
 *
 * A backend with `start` but no `startAdvertising`/`startDiscovery` is honoured as far as it goes and says
 * so — see `_applyDiscoverability`.
 */

export class MdnsTransport extends Transport {
  #hostname;
  #pubKey;
  #identity;
  #native;
  #emitter;

  // connectionId → pubKey (identified connections)
  #connToPubKey = new Map();
  // pubKey → connectionId (reverse lookup for _put)
  #pubKeyToConn = new Map();
  // connectionId → null (unidentified inbound, waiting for hello frame)
  #pending      = new Set();
  // connectionId → the handshake in flight: { role: 'dialler'|'listener', peer, nonce, timer }
  #handshakes   = new Map();
  // pubKeys being dialled (a second discovery event mid-handshake must not open a second socket)
  #dialling     = new Set();
  // pubKey → ms timestamp of last successful send or inbound frame — used
  // by routing to detect zombie TCP connections (present in the maps but
  // not actually delivering).  A value of 0 means "never seen activity".
  #lastActivity = new Map();

  #eventSubs    = [];
  #started      = false;
  // Whether the NSD service record is currently published. Distinct from #started: since the native split
  // a transport can be running and browsing while announcing nothing.
  #advertising  = false;

  /**
   * @param {object} opts
   * @param {import('@onderling/core').AgentIdentity} opts.identity
   * @param {string} [opts.hostname]  — mDNS service name (defaults to pubKey slice)
   * @param {object} opts.native      — the backend (see the contract above)
   * @param {{addListener:Function}} opts.emitter — the backend's event source
   */
  constructor({ identity, hostname = null, native = null, emitter = null }) {
    if (!identity) throw new Error('MdnsTransport requires identity');
    if (!native || !emitter) throw new Error(
      'MdnsTransport: a `native` backend and an `emitter` are required. On Android construct the subclass '
      + 'from @onderling/react-native, which injects the MdnsModule native module.'
    );
    super({ address: identity.pubKey, identity });
    this.#pubKey   = identity.pubKey;
    this.#identity = identity;
    this.#hostname = hostname ?? `dw-${identity.pubKey.slice(0, 8)}`;
    this.#native   = native;
    this.#emitter  = emitter;
  }

  async connect() {
    if (this.#started) return;
    this.#started = true;
    this.#setupEvents();
    console.log('[MdnsTransport] starting service:', this.#hostname, 'type:', SERVICE_TYPE);
    // Time-box the native start so a missing WiFi interface doesn't hang agent.start().
    await Promise.race([
      this.#native.start(SERVICE_TYPE, this.#hostname, this.#pubKey),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('MdnsTransport: start timed out (WiFi off?)')), 6_000)
      ),
    ]);
    this.#advertising = true;   // the combined start() always announces
    console.log('[MdnsTransport] service started');
  }

  // ── Discoverability (Nearby step A) ─────────────────────────────────────────
  //
  // mDNS is the transport this surface exists FOR, and also the one that cannot yet honour it: a single
  // `this.#native.start()` registers the service AND begins browsing, so there is no way to watch the room
  // without joining it. Splitting that native call is Nearby step B.
  //
  // Until then `browse` is applied as `browse+publish` and SAID SO — the method returns the state actually
  // achieved, the surface aggregates on the most-exposed answer, and the warn below leaves a trace. The
  // alternative (accepting `browse` and quietly advertising) is the exact failure the three states exist to
  // prevent: a user in ghost mode announcing themselves to the café.

  get supportsDiscoverability() { return true; }

  /** Does this backend have the split (browse without publishing), or only the combined `start()`? */
  supportsSplit() {
    return typeof this.#native?.startAdvertising === 'function'
        && typeof this.#native?.startDiscovery   === 'function';
  }

  /** Are we currently announcing ourselves? Read by the tiebreaker — see `#setupEvents`. */
  get isAdvertising() { return this.#advertising; }

  /** @protected */
  async _applyDiscoverability(state) {
    if (state === DISCOVERABILITY.OFF) {
      await this.disconnect();
      return DISCOVERABILITY.OFF;
    }

    // Old native build: one call does both, so honour the request as far as it goes and SAY the rest.
    if (!this.supportsSplit()) {
      if (state === DISCOVERABILITY.BROWSE) {
        console.warn(
          '[MdnsTransport] browse-only requested, but this build of MdnsModule has no startDiscovery() ' +
          '— advertising ANYWAY. Rebuild the Android app to get ghost mode.',
        );
      }
      await this.connect();
      this.#advertising = true;
      return DISCOVERABILITY.PUBLISH;
    }

    this.#setupEvents();
    await this.#native.startDiscovery(SERVICE_TYPE);
    this.#started = true;

    if (state === DISCOVERABILITY.PUBLISH) {
      await this.#native.startAdvertising(SERVICE_TYPE, this.#hostname, this.#pubKey);
      this.#advertising = true;
      return DISCOVERABILITY.PUBLISH;
    }

    // Ghost mode. Note what is NOT torn down: open connections and the listening socket survive, because
    // going unlisted is about who can FIND you, not who can reach you. That is what makes `browse` a usable
    // resting state — before the split, the only way to stop announcing was to stop the transport, which
    // dropped every LAN peer you were talking to.
    if (this.#advertising) {
      await this.#native.stopAdvertising();
      this.#advertising = false;
    }
    return DISCOVERABILITY.BROWSE;
  }

  /**
   * @protected — a real restart, because `connect()` returns early on `#started`.
   *
   * This is the whole point of the verb: after a Wi-Fi switch the service is registered against an
   * interface that no longer exists, `#started` is still true, and every "make sure we are announcing" path
   * short-circuits. Tearing down first is what makes the re-announce actually reach the new network.
   */
  async _reannounce(state) {
    // With the split we can re-publish the service record without touching the data plane — so a Wi-Fi
    // change no longer costs you the connections you already have. Without it, a full restart is the only
    // way to get past `connect()`'s `#started` short-circuit.
    if (this.supportsSplit() && this.#started) {
      if (this.#advertising) {
        await this.#native.stopAdvertising().catch(() => {});
        this.#advertising = false;
      }
      await this.#native.stopDiscovery().catch(() => {});
      this.#eventSubs.forEach((sub) => sub.remove());
      this.#eventSubs = [];
      this.#started = false;
      return this._applyDiscoverability(state);
    }
    await this.disconnect();
    return this._applyDiscoverability(state);
  }

  async disconnect() {
    if (!this.#started) return;
    this.#started    = false;
    this.#advertising = false;
    for (const sub of this.#eventSubs) sub.remove();
    this.#eventSubs = [];
    await this.#native.stop().catch(() => {});
    this.#connToPubKey.clear();
    this.#pubKeyToConn.clear();
    this.#pending.clear();
    this.#lastActivity.clear();
  }

  get _pubKeyToConn() { return this.#pubKeyToConn; }

  /**
   * Number of currently identified peer connections.  Read-only signal
   * intended for passive UI ("Nearby: N device(s)") — kept in sync with
   * the pubKey→connId map, so it updates as peer-discovered /
   * peer-disconnected events fire on this transport.  v2 circle 5.9c.
   */
  get connectionCount() { return this.#pubKeyToConn.size; }
  /**
   * Who is connected RIGHT NOW. `peer-discovered` is an event — a listener that binds after the handshake
   * never hears it — so a surface that starts late reads this once and then follows the events.
   * @returns {string[]} peer pubKeys
   */
  connectedPeers() { return [...this.#pubKeyToConn.keys()]; }

  _hasPeer(pubKey) {
    return this.#pubKeyToConn.has(pubKey);
  }

  /**
   * ms-epoch timestamp of last successful send / inbound frame for this
   * peer, or 0 if we've never observed activity.  The routing layer uses
   * this to avoid picking a zombie TCP connection over a live BLE one.
   */
  lastActivityAt(pubKey) {
    return this.#lastActivity.get(pubKey) ?? 0;
  }

  /**
   * How long a connection may sit silent before `lastActivityAt` counts as stale — a DIAGNOSTIC, no
   * longer the routing rule. It used to gate `canReach()`: a peer quiet for 30 s was "unreachable" so the
   * router would fall through to BLE / relay after a Wi-Fi drop left a half-open socket. On a LAN that made
   * every idle peer unroutable — the Nearby room's whole population sits idle between asks — and the
   * phone's first ask to a peer it had listed for a minute went out over NKN and timed out (2026-08-30).
   */
  static FRESHNESS_MS = 30_000;

  /**
   * Routing hint (Group EE). Reachable iff we hold a live TCP connection to the peer — the socket is the
   * truth. A half-open socket after a Wi-Fi drop is caught where it shows: the send fails, the native side
   * closes and reports the connection, the maps clear, and the router's failure path picks another route.
   */
  canReach(pubKey) {
    return this.#pubKeyToConn.has(pubKey);
  }

  /** Has this peer's connection been silent for longer than the freshness window? Diagnostics only. */
  isStale(pubKey) {
    if (!this.#pubKeyToConn.has(pubKey)) return true;
    return (Date.now() - (this.#lastActivity.get(pubKey) ?? 0)) >= MdnsTransport.FRESHNESS_MS;
  }

  /**
   * Drop cached connection for a peer and close the TCP socket.  Subsequent
   * mDNS service-discovery events for the same peer will reopen the connection.
   */
  forgetPeer(pubKey) {
    const connId = this.#pubKeyToConn.get(pubKey);
    if (connId == null) return;
    this.#pubKeyToConn.delete(pubKey);
    this.#connToPubKey.delete(connId);
    this.#lastActivity.delete(pubKey);
    this.#native.close?.(connId).catch(() => {});
  }

  async _put(to, envelope) {
    const connId = this.#pubKeyToConn.get(to);
    if (!connId) throw new Error(`MdnsTransport: no connection to ${to}`);
    const json  = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(json);
    await this.#native.send(connId, b64Encode(bytes));
    this.#lastActivity.set(to, Date.now());
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #setupEvents() {
    // Idempotent: `connect()` and `_applyDiscoverability()` both call this, and a JS reload calls it
    // again — without this guard one inbound connection was handled (and logged) up to six times.
    if (this.#eventSubs.length) return;
    this.#eventSubs.push(
      // Peer discovered via mDNS — apply tiebreaker before connecting
      this.#emitter.addListener('MdnsServiceDiscovered', async ({ host, port, pubKey }) => {
        console.log('[MdnsTransport] ServiceDiscovered:', pubKey?.slice(0,12), host, port);
        if (pubKey === this.#pubKey) { console.log('[MdnsTransport] skipping self'); return; }
        if (this.#pubKeyToConn.has(pubKey)) { console.log('[MdnsTransport] already connected'); return; }
        // Tiebreaker — but only when BOTH sides can see each other. It exists to stop two peers opening
        // duplicate sockets, and that can only happen if they can each discover the other. In ghost mode
        // nobody can discover us, so deferring to the peer means waiting for a connection that will never
        // come: we would list the room and connect to only the half of it that sorts above us.
        if (this.#advertising && this.#pubKey > pubKey) {
          console.log('[MdnsTransport] responder side, waiting for inbound');
          return;
        }

        if (this.#dialling.has(pubKey)) return;
        console.log('[MdnsTransport] initiating TCP connect to', host, port);
        this.#dialling.add(pubKey);
        try {
          const connId = await this.#native.connect(host, port);
          console.log('[MdnsTransport] TCP connected, connId:', connId);
          // NOT keyed yet: the TXT record's pubKey is a claim until the listener signs our nonce with it
          const nonce = freshNonce();
          this.#startHandshake(connId, { role: 'dialler', peer: pubKey, nonce });
          await this.#sendFrame(connId, { _mdns_hello: true, _from: this.#pubKey, nonce });
        } catch (err) {
          this.#dialling.delete(pubKey);
          console.warn('[MdnsTransport] connect/hello failed:', err?.message);
          this.emit('error', err);
        }
      }),

      // New inbound connection — hold in pending until hello frame arrives
      this.#emitter.addListener('MdnsClientConnected', ({ connectionId }) => {
        console.log('[MdnsTransport] inbound connection:', connectionId);
        this.#pending.add(connectionId);
      }),

      // Complete message received on any connection
      this.#emitter.addListener('MdnsDataReceived', ({ connectionId, data }) => {
        let envelope;
        try {
          envelope = JSON.parse(new TextDecoder().decode(b64Decode(data)));
        } catch { return; }

        // The handshake frames are internal: never passed upstream, and the only way a connection gets a key.
        if (envelope && (envelope._mdns_hello || envelope._mdns_challenge || envelope._mdns_proof)) {
          this.#onHandshakeFrame(connectionId, envelope);
          return;
        }
        // Any other frame on a connection that has not proven itself goes upstream (the agent verifies every
        // envelope on its own), but the connection stays unkeyed: no row, no route.
        if (this.#pending.has(connectionId) && !this.#handshakes.has(connectionId)) this.#pending.delete(connectionId);

        const mappedPubKey = this.#connToPubKey.get(connectionId);
        if (mappedPubKey) this.#lastActivity.set(mappedPubKey, Date.now());

        try { this._receive(envelope); } catch {}
      }),

      // Connection closed — clean up both maps
      this.#emitter.addListener('MdnsClientDisconnected', ({ connectionId }) => {
        this.#pending.delete(connectionId);
        this.#endHandshake(connectionId);
        const pubKey = this.#connToPubKey.get(connectionId);
        if (pubKey) {
          this.#connToPubKey.delete(connectionId);
          // Only forget the peer if THIS was still their live connection — a replaced socket closing late
          // must not unmap the one that replaced it.
          if (this.#pubKeyToConn.get(pubKey) === connectionId) {
            this.#pubKeyToConn.delete(pubKey);
            this.#lastActivity.delete(pubKey);
            this.emit('peer-disconnected', pubKey);
          }
        }
      }),

      this.#emitter.addListener('MdnsError', ({ message }) => {
        this.emit('error', new Error(`MdnsModule: ${message}`));
      }),
    );
  }

  async #sendFrame(connId, obj) {
    await this.#native.send(connId, b64Encode(new TextEncoder().encode(JSON.stringify(obj))));
  }

  #startHandshake(connId, hs) {
    const timer = setTimeout(() => {
      if (!this.#handshakes.has(connId)) return;
      console.warn('[MdnsTransport] hello not proven in time — closing', connId);
      this.#refuse(connId);
    }, HANDSHAKE_MS);
    timer.unref?.();
    this.#handshakes.set(connId, { ...hs, timer });
  }

  #endHandshake(connId) {
    const hs = this.#handshakes.get(connId);
    if (!hs) return null;
    clearTimeout(hs.timer);
    this.#handshakes.delete(connId);
    if (hs.role === 'dialler') this.#dialling.delete(hs.peer);
    return hs;
  }

  /** A connection that could not prove its key is closed — it was never a row, never a route. */
  #refuse(connId) {
    this.#endHandshake(connId);
    this.#pending.delete(connId);
    this.#native.close?.(connId).catch(() => {});
  }

  #onHandshakeFrame(connId, f) {
    const hs = this.#handshakes.get(connId);
    // listener: a hello on an inbound connection → challenge it, prove ourselves
    if (f._mdns_hello && this.#pending.has(connId) && !hs) {
      const claimed = typeof f._from === 'string' ? f._from : null;
      if (!claimed || claimed === this.#pubKey || typeof f.nonce !== 'string') { this.#refuse(connId); return; }
      const nonce = freshNonce();
      this.#startHandshake(connId, { role: 'listener', peer: claimed, nonce });
      const sig = sigB64(this.#identity.sign(helloProof(f.nonce, this.#pubKey, claimed)));
      this.#sendFrame(connId, { _mdns_challenge: true, _from: this.#pubKey, nonce, sig }).catch(() => this.#refuse(connId));
      return;
    }
    // dialler: the listener proved its key → key the connection, prove ours
    if (f._mdns_challenge && hs?.role === 'dialler') {
      const ok = f._from === hs.peer && typeof f.nonce === 'string' && verifies(helloProof(hs.nonce, f._from, this.#pubKey), f.sig, f._from);
      if (!ok) { console.warn('[MdnsTransport] listener did not prove', String(hs.peer).slice(0, 12)); this.#refuse(connId); return; }
      this.#endHandshake(connId);
      const sig = sigB64(this.#identity.sign(helloProof(f.nonce, this.#pubKey, hs.peer)));
      this.#sendFrame(connId, { _mdns_proof: true, sig }).catch(() => {});
      const previous = this.#pubKeyToConn.get(hs.peer);
      this.#registerConn(connId, hs.peer);
      if (!previous) this.emit('peer-discovered', hs.peer);
      return;
    }
    // listener: the dialler proved its key → key the connection
    if (f._mdns_proof && hs?.role === 'listener') {
      if (!verifies(helloProof(hs.nonce, hs.peer, this.#pubKey), f.sig, hs.peer)) {
        console.warn('[MdnsTransport] dialler did not prove', String(hs.peer).slice(0, 12)); this.#refuse(connId); return;
      }
      this.#endHandshake(connId);
      this.#pending.delete(connId);
      // A hello on a NEW connection from a peer we already map: the new socket is the live one (a peer that restarted
      // dials again before its dead socket's close reaches us). Re-map rather than ignore; the old connection is NOT
      // closed (when both sides dialled at once it is the peer's live inbound) and its late close cannot unmap this.
      const previous = this.#pubKeyToConn.get(hs.peer);
      this.#registerConn(connId, hs.peer);
      if (!previous) this.emit('peer-discovered', hs.peer);
      return;
    }
    // anything else (a frame out of order, a second hello) is a connection that is not following the contract
    this.#refuse(connId);
  }

  #registerConn(connId, pubKey) {
    this.#connToPubKey.set(connId, pubKey);
    this.#pubKeyToConn.set(pubKey, connId);
    // A connection we just opened IS activity. Only the responder path stamped this before, so the
    // initiator's `canReach()` said false to a peer it had dialled seconds ago — until that peer spoke
    // first — and the router fell back to the relay for someone on the same Wi-Fi.
    this.#lastActivity.set(pubKey, Date.now());
  }
}

