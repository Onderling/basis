/**
 * RendezvousTransport — WebRTC DataChannel transport (Group F).
 *
 * Uses a signaling transport (e.g. RelayTransport) to exchange SDP offers/answers
 * and ICE candidates, then switches all further communication to a direct
 * RTCDataChannel. After the channel opens, the relay is out of the data path.
 *
 * ── Platform support ──────────────────────────────────────────────────────────
 * • Browser: works out of the box (uses globalThis.RTCPeerConnection).
 * • Node.js: pass a polyfill as opts.rtcLib (e.g. `node-datachannel` or `wrtc`).
 * • React Native: NOT supported without a polyfill — see Option A below.
 *   The transport loads safely on React Native (stubs throw only on first use),
 *   but `connectToPeer()` and answering offers will throw at runtime.
 *   Use `RendezvousTransport.isSupported()` to guard before instantiating.
 *
 * ── Option A: enable on React Native with react-native-webrtc ────────────────
 * react-native-webrtc provides RTCPeerConnection/RTCSessionDescription/RTCIceCandidate
 * as React Native native modules:
 *
 *   npm install react-native-webrtc
 *   # Android: already works; iOS: pod install
 *
 * Then pass the polyfill explicitly in agent.js:
 *
 *   import { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate }
 *     from 'react-native-webrtc';
 *   const rdv = new RendezvousTransport({
 *     signalingTransport: relay,
 *     identity,
 *     rtcLib: { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate },
 *   });
 *
 * ── Option B (current): keep RendezvousTransport web-only ────────────────────
 * The mobile app (agent.js) does not instantiate RendezvousTransport at all.
 * WebRTC peer connections are therefore only used in browser demo tabs.
 * Phone-to-phone data flows via MdnsTransport (TCP) or BleTransport instead.
 *
 * ── To disable RendezvousTransport for a platform ────────────────────────────
 * Guard instantiation in agent.js with:
 *   if (RendezvousTransport.isSupported()) { ... }
 * or simply don't add it as a transport on React Native (current approach).
 *
 * Signaling message format (sent as OW via signalingTransport):
 *   { type:'rtc-offer',     from, sdp  }
 *   { type:'rtc-answer',    from, sdp  }
 *   { type:'rtc-ice',       from, candidate }
 *   { type:'rtc-close',     from }
 *
 * Usage:
 *   const relay = new RelayTransport({ relayUrl, identity });
 *   const rdv   = new RendezvousTransport({ signalingTransport: relay, identity });
 *   await relay.connect();
 *   await rdv.connect();        // registers signaling listener
 *   await rdv.connectToPeer(peerAddress);  // initiates WebRTC handshake
 *   await rdv._put(peerAddress, envelope); // send via DataChannel
 */
import { Transport } from '@onderling/core';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

const CHANNEL_LABEL  = 'onderling';
// Parameter register (#36) — WebRTC channel-open timeout (scope:device, kind:internal).
const OPEN_TIMEOUT   = param({ key: 'transports.openTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });   // ms
const ICE_SERVERS    = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * WebRTC DataChannel `Transport`: exchanges SDP offers/answers and ICE candidates over a
 * signaling transport (e.g. `RelayTransport`), then moves all further traffic to a direct
 * RTCDataChannel — the relay leaves the data path once the channel opens. Browser-first; Node and
 * React Native need an injected `rtcLib` polyfill. Use `RendezvousTransport.isSupported()` to
 * guard instantiation where WebRTC globals may be missing.
 */
export class RendezvousTransport extends Transport {
  #sig;           // signaling transport
  #rtc;           // { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate }
  #peers;         // Map<peerAddress, { pc: RTCPeerConnection, dc: RTCDataChannel }>
  #pending;       // Map<peerAddress, { resolve, reject, timer }>
  #sigHandler;    // bound message handler on #sig

  /**
   * @param {object} opts
   * @param {import('@onderling/core').Transport}                    opts.signalingTransport
   * @param {import('../identity/AgentIdentity.js').AgentIdentity} opts.identity
   * @param {object} [opts.rtcLib]    — { RTCPeerConnection, RTCSessionDescription, RTCIceCandidate }
   * @param {object[]} [opts.iceServers]   — default: Google STUN
   */
  constructor({ signalingTransport, identity, rtcLib = null, iceServers = ICE_SERVERS }) {
    if (!signalingTransport) throw new Error('RendezvousTransport requires signalingTransport');
    if (!identity)           throw new Error('RendezvousTransport requires identity');
    super({ address: identity.pubKey, identity });
    this.#sig     = signalingTransport;
    this.#rtc     = rtcLib ?? _globalRtc();
    this.#peers   = new Map();
    this.#pending = new Map();

    this._iceServers = iceServers;
  }

  /**
   * Returns true if WebRTC globals are available in the current runtime.
   * Use this to guard RendezvousTransport instantiation on React Native
   * unless you are passing an explicit rtcLib polyfill.
   *
   * @returns {boolean}
   */
  static isSupported() {
    return typeof globalThis !== 'undefined' &&
           typeof globalThis.RTCPeerConnection === 'function';
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async connect() {
    // Wrap — not replace — the existing receive handler. RTC-signalling
    // envelopes are consumed here; everything else is passed through to
    // the signalling transport's prior handler (typically the Agent's
    // dispatch loop). Critical when the signalling transport is shared
    // with the Agent for normal traffic.
    const prev = this.#sig.receiveHandler ?? null;
    this.#sig.setReceiveHandler(env => {
      const p = env.payload ?? {};
      if (['rtc-offer','rtc-answer','rtc-ice','rtc-close'].includes(p.type)) {
        this.#onSignal(env);
        return;
      }
      if (typeof prev === 'function') prev(env);
      else this.emit('envelope', env);
    });
  }

  async disconnect() {
    for (const entry of this.#peers.values()) {
      try { entry?.pc?.close?.(); } catch { /* already closed */ }
      try { entry?.dc?.close?.(); } catch { /* already closed */ }
    }
    this.#peers.clear();
    for (const { reject, timer, pc } of this.#pending.values()) {
      clearTimeout(timer);
      try { pc?.close?.(); } catch { /* already closed */ }
      reject(new Error('RendezvousTransport disconnected'));
    }
    this.#pending.clear();
  }

  // ── Initiate a peer connection ────────────────────────────────────────────

  /**
   * Initiate a WebRTC connection to a peer.
   * The peer must also have a RendezvousTransport running on the same signaling channel.
   *
   * @param {string}  peerAddress
   * @param {number}  [timeout=30000]
   * @returns {Promise<void>} resolves when DataChannel is open
   */
  async connectToPeer(peerAddress, timeout = OPEN_TIMEOUT) {
    if (this.#peers.has(peerAddress)) return; // already connected

    const { RTCPeerConnection } = this.#rtc;
    const pc = new RTCPeerConnection({ iceServers: this._iceServers });
    const dc = pc.createDataChannel(CHANNEL_LABEL);

    this.#wirePc(pc, peerAddress);
    this.#wireDc(dc, peerAddress);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await this.#sig.sendOneWay(peerAddress, {
      type: 'rtc-offer', from: this.address, sdp: offer.sdp,
    });

    await this.#awaitOpen(peerAddress, { pc, dc }, timeout);
  }

  /**
   * True if we currently hold an open DataChannel to this peer.
   * Used by the Agent layer to decide whether routing should prefer
   * rendezvous for a given peer.
   *
   * @param {string} peerAddress
   * @returns {boolean}
   */
  hasOpenChannelTo(peerAddress) {
    const entry = this.#peers.get(peerAddress);
    return !!(entry?.dc && entry.dc.readyState === 'open');
  }

  /** @override — rendezvous is peer-scoped, unlike relay/internal. */
  canReach(peerAddress) { return this.hasOpenChannelTo(peerAddress); }

  // ── Send via DataChannel ──────────────────────────────────────────────────

  async _put(to, envelope) {
    const peer = this.#peers.get(to);
    if (!peer?.dc || peer.dc.readyState !== 'open') {
      throw new Error(`RendezvousTransport: no open DataChannel to ${to}`);
    }
    peer.dc.send(JSON.stringify(envelope));
  }

  // ── Signaling inbound ─────────────────────────────────────────────────────

  async #onSignal(envelope) {
    const p    = envelope.payload ?? {};
    const from = p.from ?? envelope._from;

    switch (p.type) {

      case 'rtc-offer': {
        const { RTCPeerConnection, RTCSessionDescription } = this.#rtc;
        const pc = new RTCPeerConnection({ iceServers: this._iceServers });
        this.#wirePc(pc, from);

        pc.ondatachannel = ({ channel }) => {
          this.#wireDc(channel, from);
          this.#peers.set(from, { pc, dc: channel });
        };

        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: p.sdp }));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await this.#sig.sendOneWay(from, {
          type: 'rtc-answer', from: this.address, sdp: answer.sdp,
        });
        break;
      }

      case 'rtc-answer': {
        const peer = this.#peers.get(from) ?? this.#pending.get(from);
        if (!peer?.pc) break;
        const { RTCSessionDescription } = this.#rtc;
        await peer.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: p.sdp }));
        break;
      }

      case 'rtc-ice': {
        const peer = this.#peers.get(from) ?? this.#pending.get(from);
        if (!peer?.pc || !p.candidate) break;
        const { RTCIceCandidate } = this.#rtc;
        await peer.pc.addIceCandidate(new RTCIceCandidate(p.candidate)).catch(() => {});
        break;
      }

      case 'rtc-close': {
        const peer = this.#peers.get(from);
        if (peer) { peer.pc.close(); this.#peers.delete(from); }
        this.emit('peer-disconnected', from);
        break;
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  #wirePc(pc, peerAddress) {
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.#sig.sendOneWay(peerAddress, {
        type: 'rtc-ice', from: this.address, candidate: candidate.toJSON(),
      }).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        const pending = this.#pending.get(peerAddress);
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`WebRTC connection to ${peerAddress} ${pc.connectionState}`));
          this.#pending.delete(peerAddress);
        }
      }
    };
  }

  #wireDc(dc, peerAddress) {
    dc.onopen = () => {
      // Preserve an existing answerer-side pc if we have one; spread
      // pending only when present (initiator path).
      const existing = this.#peers.get(peerAddress);
      const pending  = this.#pending.get(peerAddress);
      this.#peers.set(peerAddress, { ...(existing ?? pending ?? {}), dc });
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve();
        this.#pending.delete(peerAddress);
      }
      this.emit('peer-connected', peerAddress);
    };
    dc.onmessage = ({ data }) => {
      try { this._receive(JSON.parse(data)); } catch { /* drop malformed */ }
    };
    dc.onclose = () => {
      this.#peers.delete(peerAddress);
      this.emit('peer-disconnected', peerAddress);
    };
  }

  #awaitOpen(peerAddress, peerData, timeout) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        peerData.pc.close();
        this.#pending.delete(peerAddress);
        reject(new Error(`RendezvousTransport: timeout connecting to ${peerAddress}`));
      }, timeout);
      this.#pending.set(peerAddress, { ...peerData, resolve, reject, timer });
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _globalRtc() {
  const G = typeof globalThis !== 'undefined' ? globalThis : {};
  if (!G.RTCPeerConnection) {
    // Return stubs so the class loads without crashing in Node.js.
    return {
      RTCPeerConnection:   _unsupported('RTCPeerConnection'),
      RTCSessionDescription: _unsupported('RTCSessionDescription'),
      RTCIceCandidate:     _unsupported('RTCIceCandidate'),
    };
  }
  return {
    RTCPeerConnection:   G.RTCPeerConnection,
    RTCSessionDescription: G.RTCSessionDescription,
    RTCIceCandidate:     G.RTCIceCandidate,
  };
}

function _unsupported(name) {
  return class {
    constructor() {
      throw new Error(
        `${name} is not available. RendezvousTransport requires a browser or a WebRTC polyfill ` +
        '(e.g. npm install node-datachannel). Pass it as opts.rtcLib.',
      );
    }
  };
}
