/**
 * MdnsTransport — local-network peer discovery + TCP data channel.
 *
 * Delegates all mDNS (DNS-SD via Android NsdManager) and TCP socket work to
 * the custom MdnsModule native module (MdnsModule.kt). The JS layer is only
 * responsible for routing: matching discovered peers to connections and
 * maintaining the pubKey → connectionId map.
 *
 * Connection tiebreaker: to avoid duplicate sockets when both peers discover
 * each other simultaneously, only the peer whose pubKey sorts lexicographically
 * lower initiates. The larger-key peer waits for the inbound connection.
 * The initiating side sends a `_mdns_hello` frame immediately so the server
 * can register the connection under the real pubKey before app data arrives.
 *
 * Framing is handled entirely in Kotlin (4-byte big-endian length prefix +
 * DataInputStream.readFully). Each MdnsDataReceived event carries exactly one
 * complete message — no reassembly needed here.
 *
 * ── To disable MdnsTransport ─────────────────────────────────────────────────
 * In apps/mesh-demo/src/agent.js, comment out (or set null) the mdns block:
 *
 *   // mdns = null;  // ← uncomment to disable
 *   // if (...) { mdns = new MdnsTransport(...) }  ← or comment out this block
 *
 * Then change:  const primary = mdns ?? relay
 * To:           const primary = relay
 *
 * Or use the static guard:
 *   if (MdnsTransport.isAvailable()) { mdns = new MdnsTransport(...); }
 *
 * ── Dependencies ──────────────────────────────────────────────────────────────
 * No npm peer dependencies — requires MdnsModule.kt + MdnsPackage.kt to be
 * compiled into the Android app (already registered in MainApplication.kt).
 * react-native-zeroconf and react-native-tcp-socket are no longer needed.
 */
import { NativeModules, NativeEventEmitter } from 'react-native';
import { Transport, DISCOVERABILITY }        from '@onderling/core';
import { b64Encode, b64Decode }              from '../utils/base64.js';

const MdnsNative = NativeModules.MdnsModule ?? null;
const mdnsEmitter = MdnsNative ? new NativeEventEmitter(MdnsNative) : null;

const SERVICE_TYPE = '_canopy';

export class MdnsTransport extends Transport {
  #hostname;
  #pubKey;

  // connectionId → pubKey (identified connections)
  #connToPubKey = new Map();
  // pubKey → connectionId (reverse lookup for _put)
  #pubKeyToConn = new Map();
  // connectionId → null (unidentified inbound, waiting for hello frame)
  #pending      = new Set();
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
   * Returns false if the native module is not compiled into the app.
   * Use this to skip instantiation during development or on platforms
   * where MdnsModule.kt is not available.
   */
  static isAvailable() {
    return MdnsNative !== null;
  }

  /**
   * @param {object} opts
   * @param {import('@onderling/core').AgentIdentity} opts.identity
   * @param {string} [opts.hostname]  — mDNS service name (defaults to pubKey slice)
   */
  constructor({ identity, hostname = null }) {
    if (!identity) throw new Error('MdnsTransport requires identity');
    if (!MdnsNative) throw new Error(
      'MdnsTransport: MdnsModule native module not found. ' +
      'Is MdnsPackage registered in MainApplication.kt?'
    );
    super({ address: identity.pubKey, identity });
    this.#pubKey   = identity.pubKey;
    this.#hostname = hostname ?? `dw-${identity.pubKey.slice(0, 8)}`;
  }

  async connect() {
    if (this.#started) return;
    this.#started = true;
    this.#setupEvents();
    console.log('[MdnsTransport] starting service:', this.#hostname, 'type:', SERVICE_TYPE);
    // Time-box the native start so a missing WiFi interface doesn't hang agent.start().
    await Promise.race([
      MdnsNative.start(SERVICE_TYPE, this.#hostname, this.#pubKey),
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
  // `MdnsNative.start()` registers the service AND begins browsing, so there is no way to watch the room
  // without joining it. Splitting that native call is Nearby step B.
  //
  // Until then `browse` is applied as `browse+publish` and SAID SO — the method returns the state actually
  // achieved, the surface aggregates on the most-exposed answer, and the warn below leaves a trace. The
  // alternative (accepting `browse` and quietly advertising) is the exact failure the three states exist to
  // prevent: a user in ghost mode announcing themselves to the café.

  get supportsDiscoverability() { return true; }

  /** Does the compiled native module have the split (Nearby step B), or only the combined `start()`? */
  static supportsSplit() {
    return typeof MdnsNative?.startAdvertising === 'function'
        && typeof MdnsNative?.startDiscovery   === 'function';
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
    if (!MdnsTransport.supportsSplit()) {
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
    await MdnsNative.startDiscovery(SERVICE_TYPE);
    this.#started = true;

    if (state === DISCOVERABILITY.PUBLISH) {
      await MdnsNative.startAdvertising(SERVICE_TYPE, this.#hostname, this.#pubKey);
      this.#advertising = true;
      return DISCOVERABILITY.PUBLISH;
    }

    // Ghost mode. Note what is NOT torn down: open connections and the listening socket survive, because
    // going unlisted is about who can FIND you, not who can reach you. That is what makes `browse` a usable
    // resting state — before the split, the only way to stop announcing was to stop the transport, which
    // dropped every LAN peer you were talking to.
    if (this.#advertising) {
      await MdnsNative.stopAdvertising();
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
    if (MdnsTransport.supportsSplit() && this.#started) {
      if (this.#advertising) {
        await MdnsNative.stopAdvertising().catch(() => {});
        this.#advertising = false;
      }
      await MdnsNative.stopDiscovery().catch(() => {});
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
    await MdnsNative.stop().catch(() => {});
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
   * Freshness threshold for canReach().  mDNS connections can go silent
   * without closing (Wi-Fi drop, peer moved subnet), leaving a live
   * socket that no longer delivers data.  A peer whose last observed
   * activity is beyond this window is treated as unreachable so
   * RoutingStrategy falls through to BLE / relay instead.
   */
  static FRESHNESS_MS = 30_000;

  /**
   * Routing hint (Group EE).  Reachable iff we have a live TCP connection
   * AND we've seen activity on it within the freshness window.
   */
  canReach(pubKey) {
    if (!this.#pubKeyToConn.has(pubKey)) return false;
    const last = this.#lastActivity.get(pubKey) ?? 0;
    return (Date.now() - last) < MdnsTransport.FRESHNESS_MS;
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
    MdnsNative.close?.(connId).catch(() => {});
  }

  async _put(to, envelope) {
    const connId = this.#pubKeyToConn.get(to);
    if (!connId) throw new Error(`MdnsTransport: no connection to ${to}`);
    const json  = JSON.stringify(envelope);
    const bytes = new TextEncoder().encode(json);
    await MdnsNative.send(connId, b64Encode(bytes));
    this.#lastActivity.set(to, Date.now());
  }

  // ── Private ────────────────────────────────────────────────────────────────

  #setupEvents() {
    this.#eventSubs.push(
      // Peer discovered via mDNS — apply tiebreaker before connecting
      mdnsEmitter.addListener('MdnsServiceDiscovered', async ({ host, port, pubKey }) => {
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

        console.log('[MdnsTransport] initiating TCP connect to', host, port);
        try {
          const connId = await MdnsNative.connect(host, port);
          console.log('[MdnsTransport] TCP connected, connId:', connId);
          this.#registerConn(connId, pubKey);
          await MdnsNative.send(connId, b64Encode(
            new TextEncoder().encode(JSON.stringify({ _mdns_hello: true, _from: this.#pubKey }))
          ));
          console.log('[MdnsTransport] hello sent, emitting peer-discovered');
          this.emit('peer-discovered', pubKey);
        } catch (err) {
          console.warn('[MdnsTransport] connect/hello failed:', err?.message);
          this.emit('error', err);
        }
      }),

      // New inbound connection — hold in pending until hello frame arrives
      mdnsEmitter.addListener('MdnsClientConnected', ({ connectionId }) => {
        console.log('[MdnsTransport] inbound connection:', connectionId);
        this.#pending.add(connectionId);
      }),

      // Complete message received on any connection
      mdnsEmitter.addListener('MdnsDataReceived', ({ connectionId, data }) => {
        let envelope;
        try {
          envelope = JSON.parse(new TextDecoder().decode(b64Decode(data)));
        } catch { return; }

        // Identify an inbound connection on first message
        if (this.#pending.has(connectionId)) {
          if (envelope._mdns_hello) {
            const peerKey = envelope._from;
            if (peerKey && !this.#pubKeyToConn.has(peerKey)) {
              this.#pending.delete(connectionId);
              this.#registerConn(connectionId, peerKey);
              this.#lastActivity.set(peerKey, Date.now());
              this.emit('peer-discovered', peerKey);
            }
            return; // internal frame — don't pass upstream
          }
          // Non-hello first frame: pass upstream and let Agent identify via its own protocol
          this.#pending.delete(connectionId);
        }

        const mappedPubKey = this.#connToPubKey.get(connectionId);
        if (mappedPubKey) this.#lastActivity.set(mappedPubKey, Date.now());

        try { this._receive(envelope); } catch {}
      }),

      // Connection closed — clean up both maps
      mdnsEmitter.addListener('MdnsClientDisconnected', ({ connectionId }) => {
        this.#pending.delete(connectionId);
        const pubKey = this.#connToPubKey.get(connectionId);
        if (pubKey) {
          this.#connToPubKey.delete(connectionId);
          this.#pubKeyToConn.delete(pubKey);
          this.#lastActivity.delete(pubKey);
          this.emit('peer-disconnected', pubKey);
        }
      }),

      mdnsEmitter.addListener('MdnsError', ({ message }) => {
        this.emit('error', new Error(`MdnsModule: ${message}`));
      }),
    );
  }

  #registerConn(connId, pubKey) {
    this.#connToPubKey.set(connId, pubKey);
    this.#pubKeyToConn.set(pubKey, connId);
  }
}

