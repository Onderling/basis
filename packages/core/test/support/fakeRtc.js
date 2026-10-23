/**
 * A fake WebRTC library for `RendezvousTransport` — enough to open a DataChannel between two in-process peers and
 * carry frames over it, without the native `node-datachannel` build (absent here and on CI, which made every
 * rendezvous conformance run a skip). The offer/answer descriptions are tokens; when the offerer applies the answer,
 * the two channels are linked and both open. ICE is a no-op (there is no network to traverse). It models the channel,
 * not the network: what a test can check with it is what the transport does with frames on an open channel.
 */
export function createFakeRtcLib() {
  const offers = new Map();   // offer sdp → the offering peer connection
  let seq = 0;
  class FakeChannel {
    constructor(label) { this.label = label; this.readyState = 'connecting'; this.peer = null; }
    send(data) {
      if (this.readyState !== 'open' || !this.peer) throw new Error('fake DataChannel not open');
      const to = this.peer;
      setTimeout(() => to.onmessage?.({ data }), 0);
    }
    close() {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed'; this.onclose?.();
      const p = this.peer; this.peer = null; if (p) p.close();
    }
    _open() { this.readyState = 'open'; this.onopen?.(); }
  }
  class FakePeerConnection {
    constructor() { this.connectionState = 'new'; this.dc = null; this.remoteOffer = null; this.answerSdp = null; }
    createDataChannel(label) { this.dc = new FakeChannel(label); return this.dc; }
    async createOffer() { return { type: 'offer', sdp: `offer-${++seq}` }; }
    async createAnswer() { this.answerSdp = `answer-${++seq}`; return { type: 'answer', sdp: this.answerSdp }; }
    async setLocalDescription(desc) { if (desc?.type === 'offer') offers.set(desc.sdp, this); }
    async setRemoteDescription(desc) {
      if (desc?.type === 'offer') { this.remoteOffer = offers.get(desc.sdp) ?? null; this.remoteOffer.answerer = this; return; }
      if (desc?.type === 'answer') {
        const answerer = this.answerer;
        if (!answerer || !this.dc) return;
        const theirs = new FakeChannel(this.dc.label);
        this.dc.peer = theirs; theirs.peer = this.dc;
        this.connectionState = 'connected'; answerer.connectionState = 'connected';
        setTimeout(() => {
          answerer.ondatachannel?.({ channel: theirs });
          theirs._open(); this.dc._open();
        }, 0);
      }
    }
    async addIceCandidate() {}
    close() { this.connectionState = 'closed'; this.dc?.close(); }
  }
  return {
    RTCPeerConnection: FakePeerConnection,
    RTCSessionDescription: class { constructor(d) { Object.assign(this, d); } },
    RTCIceCandidate: class { constructor(c) { Object.assign(this, c); } },
  };
}
