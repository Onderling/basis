/**
 * A FLUSH STOPS AN ADDRESS ONLY FOR A FAILURE OF THE ADDRESS. One address's hold queue carries entries of different
 * senders and terms. A failure that belongs to the ENTRY (a persona with no socket of its own yet, a scope that allows no
 * route, a refusal) says nothing about the entries behind it: that entry is re-held and the next one is tried. Only the
 * address not answering (unreachable, the handshake timed out) stops the flush and re-holds the rest in order.
 *
 * And what joins the hold WHILE a flush to that address is in flight (the flush's attempt was the not-yet address's one,
 * so a send meanwhile is held without a wire attempt) is drained by that same flush once the address has answered,
 * after what the flush already held; a second flush meanwhile does not take it up beside it (order).
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

async function until(pred, { timeout = 5000, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => { setTimeout(r, step); }); }
  return pred();
}

/** An in-process transport whose sends can be held back by hand: `close()` parks every put until `open()`. */
class GatedTransport extends InternalTransport {
  constructor(bus, addr) { super(bus, addr); this.gate = null; this.parked = 0; }
  canReach() { return true; }
  close() { let open; this.gate = new Promise((r) => { open = r; }); this.gate.open = open; }
  open() { const g = this.gate; this.gate = null; g?.open(); }
  async _put(to, env) {
    if (this.gate) { this.parked += 1; await this.gate; }
    return super._put(to, env);
  }
}

describe('a flush stops an address only for a failure of the address', () => {
  it("a persona's message with no socket at the head of the queue does not hold back the default self's message behind it", async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => received.push(m) });
    const persona = await AgentIdentity.generate(new VaultMemory());
    const SEND = { firstSendTimeoutMs: 400, retryDelays: [], guarantee: 'hold-forward' };
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay');
      anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey });
      const B = bram.identity.pubKey;
      // bram is away: the persona's message (no socket of its own) and then the default self's are held, in that order
      expect((await anna.peer.sendTo(B, { subtype: 'note', text: 'as the persona', msgId: 'p1' }, { ...SEND, sendAs: persona.pubKey })).held).toBe(true);
      expect((await anna.peer.sendTo(B, { subtype: 'note', text: 'as the default', msgId: 'd1' }, SEND)).held).toBe(true);
      expect(anna.heldFor(B)).toBe(2);

      await bram.relay.connect({ relayUrl: url, awaitReady: true });
      bram.setTransportMode('relay');
      await anna.flushHeld();
      const got = await until(() => received.find((m) => m.payload?.msgId === 'd1'));
      expect(got, "the default self's message went out though the persona's at the head could not").toBeTruthy();
      expect(received.find((m) => m.payload?.msgId === 'p1'), "the persona's did not leave on another socket").toBeUndefined();
      expect(anna.heldFor(B), "the persona's message is still held, the default's is not").toBe(1);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await R.close?.();
    }
  }, 30_000);
});

describe('what joins the hold during a flush that succeeds', () => {
  /** anna on a gated transport; bram's identity exists before bram does, so m1 to bram is held as not yet seen alive. */
  async function setUp() {
    const bus = new InternalBus();
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, notYetAttemptIntervalMs: 60_000 });
    const tx = new GatedTransport(bus, anna.identity.pubKey);
    await anna.addSecureTransport('relay', tx);
    const B = await AgentIdentity.generate(new VaultMemory());
    const order = [];
    const SEND = { firstSendTimeoutMs: 1500, retryDelays: [], guarantee: 'hold-forward' };
    const first = await anna.peer.sendTo(B.pubKey, { subtype: 'note', msgId: 'm1' }, { ...SEND, firstSendTimeoutMs: 200 });
    expect(first.held, 'm1 held: bram is not there yet').toBe(true);
    return { bus, anna, tx, B, order, SEND };
  }
  async function bramArrives({ bus, B, order }) {
    const bram = await createSecureAgent({ vault: new VaultMemory(), identity: B, warnOnInsecure: false, onPeerMessage: (m) => order.push(m?.payload?.msgId) });
    await bram.addSecureTransport('relay', new InternalTransport(bus, B.pubKey));
    return bram;
  }

  it('a send held while the flush is in flight goes out when the flush succeeds, after what the flush held', async () => {
    const s = await setUp();
    const bram = await bramArrives(s);
    try {
      expect((await s.anna.peer.sendTo(s.B.pubKey, { subtype: 'note', msgId: 'm2' }, s.SEND)).held, 'm2 joins the hold (within the interval)').toBe(true);
      s.tx.close();
      const flush = s.anna.flushHeld();
      await until(() => s.tx.parked > 0);                                  // m1's flush is on the wire, held back
      expect((await s.anna.peer.sendTo(s.B.pubKey, { subtype: 'note', msgId: 'm3' }, s.SEND)).held, 'm3 joins the hold during the flush').toBe(true);
      s.tx.open();
      await flush;
      await until(() => s.order.includes('m3'), { timeout: 3000 });
      expect(s.order, 'm3 delivered by the flush that found bram alive, after m1 and m2').toEqual(['m1', 'm2', 'm3']);
      expect(s.anna.heldFor(s.B.pubKey)).toBe(0);
    } finally {
      await s.anna.shutdown(); await bram.shutdown();
    }
  }, 30_000);

  it('a second flush while the first is in flight does not send the newly held message beside the first one', async () => {
    const s = await setUp();
    const bram = await bramArrives(s);
    try {
      expect((await s.anna.peer.sendTo(s.B.pubKey, { subtype: 'note', msgId: 'm2' }, s.SEND)).held).toBe(true);
      s.tx.close();
      const flushA = s.anna.flushHeld();                                   // takes [m1, m2]; m1 is held back on the wire
      await until(() => s.tx.parked > 0);
      expect((await s.anna.peer.sendTo(s.B.pubKey, { subtype: 'note', msgId: 'm3' }, s.SEND)).held).toBe(true);
      const flushB = s.anna.connectivityRestored();                        // a reconnect during the flush
      await new Promise((r) => { setTimeout(r, 50); });
      s.tx.open();
      await Promise.all([flushA, flushB]);
      await until(() => s.order.length >= 3, { timeout: 3000 });
      expect(s.order, 'm3 never goes before m2').toEqual(['m1', 'm2', 'm3']);
    } finally {
      await s.anna.shutdown(); await bram.shutdown();
    }
  }, 30_000);
});
