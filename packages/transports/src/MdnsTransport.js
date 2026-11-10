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
import { Transport, DISCOVERABILITY, AgentIdentity, createSenderBinding, SENDER_KEY_FIELD, param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';
import { b64Encode, b64Decode }       from './utils/base64.js';
import * as channel from './mdnsChannel.js';
const { ephemeralKeyPair, helloTranscript, openChannel, whisperTag, whisperFiller, bindMessage } = channel;

/** How many tags each side whispers on a LAN connection: its secrets first, random fillers for the rest, shuffled. */
export const WHISPER_SLOTS = param({ key: 'lan.whisper.slots', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 32 });

// The channel's pieces travel with the wire contract, for whoever plays the far end of a hello (a backend, a test).
/** A fresh ephemeral X25519 key pair for one hello (never stored). See `mdnsChannel.js`. */
export const channelEphemeralKeyPair = ephemeralKeyPair;
/** The hello transcript (both LAN keys, both nonces, both ephemeral keys) a channel is bound to. See `mdnsChannel.js`. */
export const channelTranscript = helloTranscript;
/** Open one end of a LAN connection's channel once its hello is proven. See `mdnsChannel.js`. */
export const openLanChannel = openChannel;
import { parseUntrustedJson } from '@onderling/core';

/**
 * THE HELLO IS PROVEN. A connection is keyed by a pubKey only when the far end has signed THIS side's nonce with that
 * key — a hello's `_from` and a TXT record's `pubKey` are claims, and keying on a claim let any device on the Wi-Fi
 * become another device's row and its route. Three frames, each side proving itself to the other:
 *   dialler → listener   { _mdns_hello: true, _from: D, nonce: nD }
 *   listener → dialler   { _mdns_challenge: true, _from: L, nonce: nL, sig: L.sign(challenge|nD|nL|L|D) }
 *   dialler → listener   { _mdns_proof: true, sig: D.sign(proof|nD|nL|D|L) }
 * The dialler keys the connection on a verified challenge (and `_from` must be the key it dialled); the listener on a
 * verified proof. The message signed is built HERE, never taken from the far end, and names its role and both nonces.
 * A connection without a key carries NO data: any other frame on it is dropped and the socket refused. Part of the wire contract: a peer
 * on an older build is never keyed (both sides must ship this together).
 */
const HELLO_DOMAIN = 'onderling-mdns-hello-v1';
/**
 * The two messages of the challenged hello — built here, never taken from the far end. They differ by ROLE and both
 * carry BOTH nonces, so a listener's challenge signature can never be replayed as a dialler's proof (or the reverse),
 * under any nonce a relay picks.
 * @param {string} nD  the dialler's nonce
 * @param {string} nL  the listener's nonce
 * @param {string} L   the listener's pubKey (it signs the challenge)
 * @param {string} D   the dialler's pubKey
 * @param {string} eD  the dialler's ephemeral channel key
 * @param {string} eL  the listener's ephemeral channel key
 * @returns {string}
 */
export const helloChallengeMessage = (nD, nL, L, D, eD, eL) => `${HELLO_DOMAIN}|challenge|${nD}|${nL}|${L}|${D}|${eD}|${eL}`;
/**
 * The dialler's proof: signed by the dialler over both nonces (see `helloChallengeMessage`).
 * @param {string} nD
 * @param {string} nL
 * @param {string} D   the dialler's pubKey (it signs the proof)
 * @param {string} L   the listener's pubKey
 * @param {string} eD
 * @param {string} eL
 * @returns {string}
 */
export const helloProofMessage = (nD, nL, D, L, eD, eL) => `${HELLO_DOMAIN}|proof|${nD}|${nL}|${D}|${L}|${eD}|${eL}`;
const HANDSHAKE_MS = 10_000;
/**
 * A rest key: a random Ed25519 identity for one network visit, in memory only (its vault is a Map that dies with it),
 * tied to no self and never registered with any security layer, so nothing the agent signs is ever sent as it.
 */
async function drawRestKey() {
  const seed = new Uint8Array(32);
  globalThis.crypto.getRandomValues(seed);
  const m = new Map();
  return AgentIdentity.fromSeed(seed, { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); } });
}
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
  // THE LAN KEY. Everything this transport says on the LAN (the TXT record, the host name, the hello and its
  // signatures) is said under this key, never under the agent's identity: a room key while a room is open, a rest key
  // otherwise (random, drawn per network visit, held in memory only, tied to no self).
  #lanKey;
  #lan;
  #lanPinned = false;
  #fixedHostname;
  #hostnamePrefix;
  #applied = null;
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
  // connectionId → its channel (see mdnsChannel.js): every frame after the hello is sealed and opened here
  #channels     = new Map();
  // THE WHISPER, per connection (see useWhisper): what I whispered (tag → my secret's entry), what they whispered,
  // the addresses of mine I proved here, and the addresses of theirs I bound here after their proof.
  #whisper      = null;
  #mine         = new Map();   // connectionId → Promise<Map<tag, entry>>
  #theirTags    = new Map();   // connectionId → Set<tag>
  #ownBound     = new Map();   // connectionId → Set<address>
  #peerBound    = new Map();   // connectionId → Set<address>
  // pubKeys being dialled (a second discovery event mid-handshake must not open a second socket)
  #dialling     = new Set();
  // pubKey → ms timestamp of last successful send or inbound frame — used
  // by routing to detect zombie TCP connections (present in the maps but
  // not actually delivering).  A value of 0 means "never seen activity".
  #lastActivity = new Map();
  /** The kernel's sender binding: a frame's `_from` must be the key its connection proved (set in the constructor). */
  #checkSender;
  #refusedSenders = 0;

  #eventSubs    = [];
  #started      = false;
  // Whether the NSD service record is currently published. Distinct from #started: since the native split
  // a transport can be running and browsing while announcing nothing.
  #advertising  = false;

  /**
   * @param {object} opts
   * @param {import('@onderling/core').AgentIdentity} opts.identity
   *   The agent's identity: the transport's address in the router. It is never said on the LAN.
   * @param {import('@onderling/core').AgentIdentity} [opts.lanIdentity] — a LAN key to start with (a room key);
   *   without one the transport draws a rest key when it first starts
   * @param {string} [opts.hostname]  — a FIXED mDNS service name (a box that is a fixed place may want one); without
   *   it the name is `<hostnamePrefix>-<LAN key slice>`, so the name changes with the LAN key and never links visits
   * @param {string} [opts.hostnamePrefix='dw']
   * @param {object} opts.native      — the backend (see the contract above)
   * @param {{addListener:Function}} opts.emitter — the backend's event source
   */
  constructor({ identity, lanIdentity = null, hostname = null, hostnamePrefix = 'dw', native = null, emitter = null }) {
    if (!identity) throw new Error('MdnsTransport requires identity');
    if (!native || !emitter) throw new Error(
      'MdnsTransport: a `native` backend and an `emitter` are required. On Android construct the subclass '
      + 'from @onderling/react-native, which injects the MdnsModule native module.'
    );
    super({ address: identity.pubKey, identity });
    this.#fixedHostname  = hostname;
    this.#hostnamePrefix = hostnamePrefix;
    if (lanIdentity) { this.#setLan(lanIdentity); this.#lanPinned = true; }
    this.#native   = native;
    this.#emitter  = emitter;
    // THE SENDER IS THE KEY THE CONNECTION PROVED. The challenged hello proves who is on the other end; a frame's
    // `_from` is only a claim. Without this, a device on the Wi-Fi with its own honestly proven key could push a
    // frame naming another listed peer, and a receiver not yet bound to that address would take the forger's key
    // for it at the first hello. The kernel's one rule (`createSenderBinding`), as the relay and NKN ask it.
    this.#checkSender = createSenderBinding({
      transportName:       'MdnsTransport',
      // FAIL CLOSED: a connection whose handshake has not proven a key refuses the frame — never `null`, which the
      // kernel reads as "this transport has no sender to offer" and lets through with a warning. (The reader below
      // also routes an unkeyed connection's data here; the invariant does not depend on that order.)
      // the connection's proven LAN key, and every address of theirs the whisper bound to it after their proof
      authenticatedSender: (connectionId) => {
        const lan = this.#connToPubKey.get(connectionId);
        if (!lan) return { refuse: 'connection-not-proven' };
        const bound = this.#peerBound.get(connectionId);
        return bound?.size ? [lan, ...bound] : lan;
      },
      onUnauthenticated:   (message) => this.emit('warn', message),
    });
  }

  /** Frames dropped because their `_from` was not the key their connection proved. */
  get refusedSenders() { return this.#refusedSenders; }

  /** The key this transport speaks on the LAN right now (null before the first start draws a rest key). */
  get lanAddress() { return this.#lanKey ?? null; }

  #setLan(identity) {
    this.#lan      = identity;
    this.#lanKey   = identity.pubKey;
    // the transport's own address IS the LAN key: what it stamps as `_from`, what it acks as, what it holds
    this._setAddress(identity.pubKey);
    this.#hostname = this.#fixedHostname ?? `${this.#hostnamePrefix}-${identity.pubKey.slice(0, 8)}`;
  }

  /** A rest key for this network visit, unless a LAN key is pinned (a room). */
  async #lanReady() {
    if (!this.#lan) this.#setLan(await drawRestKey());
  }

  /**
   * Speak on the LAN under `identity` (a room key) from now on, or, with `null`, under a fresh rest key. A key change
   * is a new presence: every LAN connection is dropped (each was proven under the old key) and the discoverability
   * that was applied is applied again under the new key.
   * @param {import('@onderling/core').AgentIdentity|null} identity
   */
  async useLanIdentity(identity = null) {
    const state = this.#applied;
    await this.disconnect();
    this.#lan = null;
    this.#lanPinned = !!identity;
    if (identity) this.#setLan(identity);
    else await this.#lanReady();
    if (state && state !== DISCOVERABILITY.OFF) await this._applyDiscoverability(state);
  }

  async connect() {
    if (this.#started) return;
    await this.#lanReady();
    this.#started = true;
    this.#setupEvents();
    console.log('[MdnsTransport] starting service:', this.#hostname, 'type:', SERVICE_TYPE);
    // Time-box the native start so a missing WiFi interface doesn't hang agent.start().
    await Promise.race([
      this.#native.start(SERVICE_TYPE, this.#hostname, this.#lanKey),
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
    this.#applied = state;
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

    await this.#lanReady();
    this.#setupEvents();
    await this.#native.startDiscovery(SERVICE_TYPE);
    this.#started = true;

    if (state === DISCOVERABILITY.PUBLISH) {
      await this.#native.startAdvertising(SERVICE_TYPE, this.#hostname, this.#lanKey);
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
    // A new network is a new visit: an unpinned LAN key is drawn again, so two networks never see one key.
    if (!this.#lanPinned) { await this.useLanIdentity(null); return this._applyDiscoverability(state); }
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
    // a handshake in flight was proven under the key being left: it ends here, and its peer may be dialled again
    for (const hs of this.#handshakes.values()) clearTimeout(hs.timer);
    this.#handshakes.clear();
    this.#dialling.clear();
    this.#channels.clear();
    for (const connId of [...this.#ownBound.keys(), ...this.#peerBound.keys()]) this.#forgetWhisper(connId);
    this.#mine.clear(); this.#theirTags.clear();
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
  /** The LAN keys of the live connections: the room. An address a whisper bound is reachable, never a row here. */
  connectedPeers() { return [...new Set(this.#connToPubKey.values())]; }

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

  // ── What the LAN may carry ──────────────────────────────────────────────────
  //
  // The agent's security layer signs an envelope as whichever of its identities `_from` names, and as the canonical
  // identity otherwise. So the gate that keeps the canonical key off the LAN is here, where the bytes leave: an
  // envelope goes out only FROM the LAN key and SIGNED BY the LAN key. A room key is registered with the security
  // layer, so a room's envelopes pass; a rest key never is, so at rest nothing the agent signs leaves at all.

  /** The LAN speaks one address of ours, its LAN key: a send as it is a send the agent may route here. */
  get supportsAliases() { return true; }

  /** Nothing outside binds an address here: only a whisper match, proven on one connection, does (useWhisper). */
  async addAddress() { return { ok: false, reason: 'the-lan-binds-only-whispered-addresses' }; }

  /**
   * THE WHISPER. `secrets()` answers what this device holds: `[{ secret, address, sign(message) → sig b64,
   * accept(address) → bool }]` — a secret shared with someone (a persona's sibling secret, a contact's pairwise one),
   * the address of mine I prove when it matches (signed by that address's key), and my rule for the address the other
   * side proves (a device map with its tombstones, a contact row). Read per connection, after the bound hello.
   * @param {() => Promise<Array<object>>|Array<object>} secrets
   */
  useWhisper(secrets) { this.#whisper = typeof secrets === 'function' ? secrets : null; }

  /**
   * @protected — may this envelope leave on the LAN? Our own rule for our own sends (a modified build can skip it, so
   * it is a convention by the enforceability test); what binds is the receiver's sender binding.
   */
  _mayCarry(envelope, connId = null) {
    // FROM: the LAN key, or an address of mine I proved on THIS connection (a whisper match) — never another
    const from = envelope?._from;
    const mine = from === this.#lanKey || (connId != null && this.#ownBound.get(connId)?.has(from) === true);
    if (!this.#lanKey || !mine) return false;
    // SIGNED BY that same key (the security layer stamps the real signer; a fallback to another identity is refused)
    const signedBy = envelope?.[SENDER_KEY_FIELD];
    if (signedBy !== undefined && signedBy !== from) return false;
    // a hello is plaintext and ANNOUNCES a key: it may announce only the key it is from (a send that did not ask to
    // speak as the room key would otherwise hand the room the agent's canonical key in the hello it signs as the room)
    if (envelope?._p === 'HI') {
      const announced = envelope?.payload?.pubKey;
      if (announced !== undefined && announced !== from) return false;
    }
    return true;
  }

  async _put(to, envelope) {
    const connId = this.#pubKeyToConn.get(to);
    if (!this._mayCarry(envelope, connId ?? null)) {
      throw Object.assign(new Error('MdnsTransport: refused to carry an envelope not from and signed by a key this connection speaks'),
        { code: 'NOT_THE_LAN_KEY' });
    }
    if (!connId) throw new Error(`MdnsTransport: no connection to ${to}`);
    const channel = this.#channels.get(connId);
    if (!channel) throw new Error(`MdnsTransport: the connection to ${to} has no channel`);
    const bytes = new TextEncoder().encode(JSON.stringify(envelope));
    await this.#sendFrame(connId, { _mdns_box: channel.seal(bytes) });
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
        if (pubKey === this.#lanKey) { console.log('[MdnsTransport] skipping self'); return; }
        // Mapped already: leave a live connection alone — a re-announcement is not a reason for a second socket. But a
        // mapped connection that has gone SILENT past the freshness window may be a dead socket to a peer that
        // restarted (its close can take minutes to reach us), and that peer, now the responder, waits for our dial:
        // dial again, and the proven handshake re-maps the peer to the live socket (as an inbound one already does).
        if (this.#pubKeyToConn.has(pubKey)) {
          if (!this.isStale(pubKey)) { console.log('[MdnsTransport] already connected'); return; }
          console.log('[MdnsTransport] mapped but silent — dialling the rediscovered peer again');
        }
        // Tiebreaker — but only when BOTH sides can see each other. It exists to stop two peers opening
        // duplicate sockets, and that can only happen if they can each discover the other. In ghost mode
        // nobody can discover us, so deferring to the peer means waiting for a connection that will never
        // come: we would list the room and connect to only the half of it that sorts above us.
        if (this.#advertising && this.#lanKey > pubKey) {
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
          const eph = ephemeralKeyPair();
          this.#startHandshake(connId, { role: 'dialler', peer: pubKey, nonce, eph });
          await this.#sendFrame(connId, { _mdns_hello: true, _from: this.#lanKey, nonce, eph: eph.publicKey });
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
          envelope = parseUntrustedJson(new TextDecoder().decode(b64Decode(data)));
        } catch (err) { this._frameRefused(err); return; }

        // The handshake frames are internal: never passed upstream, and the only way a connection gets a key.
        if (envelope && (envelope._mdns_hello || envelope._mdns_challenge || envelope._mdns_proof)) {
          this.#onHandshakeFrame(connectionId, envelope);
          return;
        }
        // THE CHANNEL. After the hello every frame is sealed under the connection's channel; one that does not open
        // (written by someone between, replayed, reordered) ends the connection, and nothing in it is read.
        const channel = this.#channels.get(connectionId);
        if (channel) {
          const plain = typeof envelope?._mdns_box === 'string' ? channel.open(envelope._mdns_box) : null;
          if (!plain) {
            this.#refusedSenders += 1;
            this.emit('security-error', Object.assign(
              new Error('MdnsTransport: a frame that does not open under the connection\'s channel — connection closed'),
              { code: 'CHANNEL_REFUSED' },
            ), null);
            this.#refuse(connectionId);
            return;
          }
          try { envelope = parseUntrustedJson(new TextDecoder().decode(plain)); }
          catch (err) { this._frameRefused(err); return; }
          // the whisper rides the channel and is the transport's own: never passed upstream
          if (envelope && (envelope._mdns_whisper || envelope._mdns_bind)) {
            const task = envelope._mdns_whisper ? this.#onWhisper(connectionId, envelope._mdns_whisper) : this.#onBind(connectionId, envelope._mdns_bind);
            task.catch((err) => this.emit('warn', `MdnsTransport: whisper: ${err?.message ?? err}`));
            return;
          }
        }
        // THE SENDER BINDING, for every data frame. No row, no route, no DATA: a frame on a connection whose handshake
        // has not proven a key is dropped and the socket refused (it cannot be replied to — the hello exists so that
        // nothing arrives from a key nobody proved). A frame claiming another sender than the key its connection proved
        // is dropped. Both are counted and reported the way a refused envelope is (`security-error`, so the agent warns
        // once per sender); nothing is ever re-mapped.
        const mappedPubKey = this.#connToPubKey.get(connectionId);
        const verdict = this.#checkSender(connectionId, envelope);
        if (!verdict.ok) {
          this.#refusedSenders += 1;
          const unproven = verdict.reason === 'connection-not-proven';
          const err = Object.assign(
            new Error(unproven
              ? 'MdnsTransport: dropped a frame on a connection that has not proven a key'
              : `MdnsTransport: dropped a frame whose _from is not the key its connection proved (${verdict.reason})`),
            { code: unproven ? 'CONNECTION_NOT_PROVEN' : 'SENDER_MISMATCH' },
          );
          this.emit('security-error', err, envelope);
          if (unproven) this.#refuse(connectionId);
          return;
        }
        if (mappedPubKey) this.#lastActivity.set(mappedPubKey, Date.now());

        try { this._receive(envelope); } catch {}
      }),

      // Connection closed — clean up both maps
      this.#emitter.addListener('MdnsClientDisconnected', ({ connectionId }) => {
        this.#pending.delete(connectionId);
        this.#channels.delete(connectionId);
        this.#forgetWhisper(connectionId);
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
    this.#channels.delete(connId);
    this.#forgetWhisper(connId);
    this.#pending.delete(connId);
    this.#native.close?.(connId).catch(() => {});
  }

  #onHandshakeFrame(connId, f) {
    const hs = this.#handshakes.get(connId);
    // listener: a hello on an inbound connection → challenge it, prove ourselves
    if (f._mdns_hello && this.#pending.has(connId) && !hs) {
      const claimed = typeof f._from === 'string' ? f._from : null;
      if (!claimed || claimed === this.#lanKey || typeof f.nonce !== 'string' || typeof f.eph !== 'string') { this.#refuse(connId); return; }
      const nonce = freshNonce();
      const eph = ephemeralKeyPair();
      this.#startHandshake(connId, { role: 'listener', peer: claimed, nonce, theirNonce: f.nonce, eph, theirEph: f.eph });
      const sig = sigB64(this.#lan.sign(helloChallengeMessage(f.nonce, nonce, this.#lanKey, claimed, f.eph, eph.publicKey)));
      this.#sendFrame(connId, { _mdns_challenge: true, _from: this.#lanKey, nonce, eph: eph.publicKey, sig }).catch(() => this.#refuse(connId));
      return;
    }
    // dialler: the listener proved its key → key the connection, prove ours
    if (f._mdns_challenge && hs?.role === 'dialler') {
      const ok = f._from === hs.peer && typeof f.nonce === 'string' && typeof f.eph === 'string'
        && verifies(helloChallengeMessage(hs.nonce, f.nonce, f._from, this.#lanKey, hs.eph.publicKey, f.eph), f.sig, f._from);
      if (!ok) { console.warn('[MdnsTransport] listener did not prove', String(hs.peer).slice(0, 12)); this.#refuse(connId); return; }
      this.#endHandshake(connId);
      // the channel first: a key that cannot key a channel gets no proof from us
      let channel;
      try {
        channel = openChannel({
          role: 'dialler', mySecret: hs.eph.secretKey, theirPublic: f.eph,
          transcript: helloTranscript({ D: this.#lanKey, L: hs.peer, nD: hs.nonce, nL: f.nonce, eD: hs.eph.publicKey, eL: f.eph }),
        });
      } catch (err) { console.warn('[MdnsTransport] no channel:', err?.message); this.#refuse(connId); return; }
      const sig = sigB64(this.#lan.sign(helloProofMessage(hs.nonce, f.nonce, this.#lanKey, hs.peer, hs.eph.publicKey, f.eph)));
      this.#sendFrame(connId, { _mdns_proof: true, sig }).catch(() => {});
      this.#channels.set(connId, channel);
      const previous = this.#pubKeyToConn.get(hs.peer);
      this.#registerConn(connId, hs.peer);
      this.#startWhisper(connId);
      if (!previous) this.emit('peer-discovered', hs.peer);
      return;
    }
    // listener: the dialler proved its key → key the connection
    if (f._mdns_proof && hs?.role === 'listener') {
      if (!verifies(helloProofMessage(hs.theirNonce, hs.nonce, hs.peer, this.#lanKey, hs.theirEph, hs.eph.publicKey), f.sig, hs.peer)) {
        console.warn('[MdnsTransport] dialler did not prove', String(hs.peer).slice(0, 12)); this.#refuse(connId); return;
      }
      this.#endHandshake(connId);
      this.#pending.delete(connId);
      let channel;
      try {
        channel = openChannel({
          role: 'listener', mySecret: hs.eph.secretKey, theirPublic: hs.theirEph,
          transcript: helloTranscript({ D: hs.peer, L: this.#lanKey, nD: hs.theirNonce, nL: hs.nonce, eD: hs.theirEph, eL: hs.eph.publicKey }),
        });
      } catch (err) { console.warn('[MdnsTransport] no channel:', err?.message); this.#refuse(connId); return; }
      this.#channels.set(connId, channel);
      // A hello on a NEW connection from a peer we already map: the new socket is the live one (a peer that restarted
      // dials again before its dead socket's close reaches us). Re-map rather than ignore; the old connection is NOT
      // closed (when both sides dialled at once it is the peer's live inbound) and its late close cannot unmap this.
      const previous = this.#pubKeyToConn.get(hs.peer);
      this.#registerConn(connId, hs.peer);
      this.#startWhisper(connId);
      if (!previous) this.emit('peer-discovered', hs.peer);
      return;
    }
    // anything else (a frame out of order, a second hello) is a connection that is not following the contract
    this.#refuse(connId);
  }

  // ── The whisper ─────────────────────────────────────────────────────────────

  async #sendSealed(connId, obj) {
    const channel = this.#channels.get(connId);
    if (!channel) return;
    await this.#sendFrame(connId, { _mdns_box: channel.seal(new TextEncoder().encode(JSON.stringify(obj))) });
  }

  /** After the bound hello: my tags (one per secret I hold, fillers for the rest, shuffled), sent at once. */
  #startWhisper(connId) {
    const channel = this.#channels.get(connId);
    if (!channel) return;
    const slots = WHISPER_SLOTS;
    const mine = (async () => {
      let entries = [];
      try { entries = (await this.#whisper?.()) ?? []; } catch { entries = []; }
      const byTag = new Map();
      for (const e of entries.slice(0, slots)) {
        if (!(e?.secret instanceof Uint8Array) || typeof e.address !== 'string') continue;
        byTag.set(whisperTag(e.secret, channel.transcript), e);
      }
      return byTag;
    })();
    this.#mine.set(connId, mine);
    mine.then((byTag) => {
      const tags = [...byTag.keys()];
      while (tags.length < slots) tags.push(whisperFiller());
      for (let i = tags.length - 1; i > 0; i--) {
        const r = new Uint32Array(1); globalThis.crypto.getRandomValues(r);
        const j = r[0] % (i + 1); [tags[i], tags[j]] = [tags[j], tags[i]];
      }
      return this.#sendSealed(connId, { _mdns_whisper: tags });
    }).catch(() => {});
  }

  /** Their tags: for each of mine that matches, prove my address on this connection. */
  async #onWhisper(connId, tags) {
    if (!Array.isArray(tags) || tags.length > WHISPER_SLOTS || this.#theirTags.has(connId)) return;
    const theirs = new Set(tags.filter((t) => typeof t === 'string'));
    this.#theirTags.set(connId, theirs);
    this.emit('whisper', [...tags]);
    const channel = this.#channels.get(connId);
    const mine = await this.#mine.get(connId);
    if (!channel || !mine) return;
    for (const [tag, e] of mine) {
      if (!theirs.has(tag)) continue;
      let sig = null;
      try { sig = await e.sign(bindMessage(channel.transcript, e.address)); } catch { sig = null; }
      if (typeof sig !== 'string') continue;
      if (!this.#ownBound.has(connId)) this.#ownBound.set(connId, new Set());
      this.#ownBound.get(connId).add(e.address);
      // the base transport's alias set: so a send AS this address is stamped from it (the gate above keeps it to
      // the connection it was proven on)
      await Transport.prototype.addAddress.call(this, e.address);
      await this.#sendSealed(connId, { _mdns_bind: { tag, address: e.address, sig } });
    }
  }

  /** Their proof for a tag we both whispered: checked under the address it names, then by my own rule. */
  async #onBind(connId, b) {
    const channel = this.#channels.get(connId);
    const theirs = this.#theirTags.get(connId);
    const mine = await this.#mine.get(connId);
    if (!channel || !theirs || !mine || !b || typeof b.tag !== 'string' || typeof b.address !== 'string') return;
    const e = mine.get(b.tag);
    if (!e || !theirs.has(b.tag)) return;   // a proof for a tag we did not both whisper binds nothing
    if (!verifies(bindMessage(channel.transcript, b.address), b.sig, b.address)) return;
    let ok = false;
    try { ok = (await e.accept(b.address)) === true; } catch { ok = false; }
    if (!ok || !this.#channels.has(connId)) return;
    if (!this.#peerBound.has(connId)) this.#peerBound.set(connId, new Set());
    this.#peerBound.get(connId).add(b.address);
    const previous = this.#pubKeyToConn.get(b.address);
    this.#pubKeyToConn.set(b.address, connId);
    this.#lastActivity.set(b.address, Date.now());
    if (previous !== connId) this.emit('peer-discovered', b.address);
  }

  /** A connection ended: what the whisper bound on it ends with it. */
  #forgetWhisper(connId) {
    this.#mine.delete(connId);
    this.#theirTags.delete(connId);
    for (const address of this.#peerBound.get(connId) ?? []) {
      if (this.#pubKeyToConn.get(address) === connId) {
        this.#pubKeyToConn.delete(address);
        this.#lastActivity.delete(address);
        this.emit('peer-disconnected', address);
      }
    }
    this.#peerBound.delete(connId);
    const own = this.#ownBound.get(connId) ?? new Set();
    this.#ownBound.delete(connId);
    for (const address of own) {
      const stillProven = [...this.#ownBound.values()].some((set) => set.has(address));
      if (!stillProven) { try { Transport.prototype.removeAddress.call(this, address); } catch { /* best-effort */ } }
    }
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

