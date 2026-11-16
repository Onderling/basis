/**
 * THE RELAY SWEEP DELIVERS ONCE. A device on more than one relay tries them in turn for a message that names no route
 * (`_sendWithFailover`'s sweep), primary first, and stops at the first that takes it. A relay's one-way send answers
 * nothing when it went out, so the sweep never saw a success: it sent on EVERY relay whose handshake passed, then fell
 * through to the budget loop and sent again on the primary (the handshake cache is shared, so the primary's handshake
 * passed too). The receiver dropped the duplicate by id, but the primary relay kept a copy for someone who is not on
 * it, and its give-up then told the sender 'did not arrive' about a message that had arrived.
 *
 * Counted at the relays: the message's own envelopes (one-way, `_p: 'OW'`) addressed to the receiver, per relay. The
 * handshake's HI on the primary is the sweep's speculative try (short, then the next relay): not counted here.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 2500, retryDelays: [] };

/** A relay that counts the one-way envelopes it is handed, per recipient. */
async function countingRelay() {
  const R = await startRelay({ port: 0, log: false });
  const ow = new Map();
  R.wss.on('connection', (ws) => ws.on('message', (raw) => {
    let msg = null;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    if (msg?.type === 'send' && msg.envelope?._p === 'OW') ow.set(msg.to, (ow.get(msg.to) ?? 0) + 1);
  }));
  return { R, url: `ws://127.0.0.1:${R.port}`, owTo: (addr) => ow.get(addr) ?? 0 };
}
async function until(pred, { timeout = 4000, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => { setTimeout(r, step); }); }
  return pred();
}

describe('the relay sweep delivers once', () => {
  it('a circle-less message to a peer on the second relay only: one envelope, on that relay; none left on the primary', async () => {
    const A = await countingRelay();
    const B = await countingRelay();
    const received = [];
    const undelivered = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onUndelivered: (u) => undelivered.push(u) });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => received.push(m) });
    try {
      await anna.relay.connect({ relayUrl: A.url, awaitReady: true });
      await anna.relays.add(B.url, { awaitReady: true });
      anna.setTransportMode('relay');
      await bram.relay.connect({ relayUrl: B.url, awaitReady: true });
      bram.setTransportMode('relay');
      const to = bram.identity.pubKey;

      await anna.peer.sendTo(to, { subtype: 'note', text: 'once', msgId: 'once-1' }, FAST);
      expect(await until(() => received.find((m) => m.payload?.msgId === 'once-1'))).toBeTruthy();
      await new Promise((res) => { setTimeout(res, 300); });   // anything still on its way to a relay lands
      expect({ A: A.owTo(to), B: B.owTo(to) }, 'the message went out once, on the relay the peer is on').toEqual({ A: 0, B: 1 });
      // nothing was left with the primary for someone who is not on it, so nothing there can later say 'did not arrive'
      expect(undelivered).toEqual([]);

      // a second message, with the handshake cached on every relay by now: the relay bram was HEARD on goes first, and
      // takes it; the primary (whose handshake passes from the cache though bram is not on it) gets nothing
      await anna.peer.sendTo(to, { subtype: 'note', text: 'twice', msgId: 'once-2' }, FAST);
      await until(() => received.find((m) => m.payload?.msgId === 'once-2'));
      await new Promise((res) => { setTimeout(res, 300); });
      expect({ A: A.owTo(to), B: B.owTo(to) }).toEqual({ A: 0, B: 2 });
    } finally {
      await anna.shutdown(); await bram.shutdown(); await A.R.stop(); await B.R.stop();
    }
  }, 30_000);

  it('a peer NOT heard yet, on both relays: each relay gets the message once (no loss), never the primary twice; once heard, one', async () => {
    const A = await countingRelay();
    const B = await countingRelay();
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => received.push(m) });
    try {
      for (const p of [anna, bram]) {
        await p.relay.connect({ relayUrl: A.url, awaitReady: true });
        await p.relays.add(B.url, { awaitReady: true });
        p.setTransportMode('relay');
      }
      const to = bram.identity.pubKey;
      await anna.peer.sendTo(to, { subtype: 'note', msgId: 'both-1' }, FAST);
      await until(() => received.some((m) => m.payload?.msgId === 'both-1'));
      await new Promise((res) => { setTimeout(res, 300); });
      // not heard when the send started: a relay taking it proves nothing, so both were tried; the primary once, not twice
      expect({ A: A.owTo(to), B: B.owTo(to) }).toEqual({ A: 1, B: 1 });
      // both copies reach this layer; the chat inbox above it drops the second by its id (the cost said in the code)
      expect(received.filter((m) => m.payload?.msgId === 'both-1').length, 'it arrived').toBeGreaterThanOrEqual(1);
      // heard now (its handshake reply): the next message goes out once, on the relay bram spoke on
      await anna.peer.sendTo(to, { subtype: 'note', msgId: 'both-2' }, FAST);
      await until(() => received.some((m) => m.payload?.msgId === 'both-2'));
      await new Promise((res) => { setTimeout(res, 300); });
      expect(A.owTo(to) + B.owTo(to), 'one envelope for the second message').toBe(3);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await A.R.stop(); await B.R.stop();
    }
  }, 30_000);

  it('a relay socket replaced after the peer was heard on it: the record names the old socket, so the peer reads as not heard and the sweep tries every relay (it arrives)', async () => {
    const A = await countingRelay();
    const B = await countingRelay();
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => received.push(m) });
    try {
      await anna.relay.connect({ relayUrl: A.url, awaitReady: true });
      await anna.relays.add(B.url, { awaitReady: true });
      anna.setTransportMode('relay');
      await bram.relay.connect({ relayUrl: B.url, awaitReady: true });
      bram.setTransportMode('relay');
      const to = bram.identity.pubKey;
      await anna.peer.sendTo(to, { subtype: 'note', msgId: 'r-1' }, FAST);
      await until(() => received.some((m) => m.payload?.msgId === 'r-1'));          // heard on B's socket now
      // B's socket replaced (removed and added again: a new transport object)
      await anna.relays.remove(B.url);
      await anna.relays.add(B.url, { awaitReady: true });
      const before = { A: A.owTo(to), B: B.owTo(to) };
      await anna.peer.sendTo(to, { subtype: 'note', msgId: 'r-2' }, FAST);
      expect(await until(() => received.some((m) => m.payload?.msgId === 'r-2')), 'it arrived').toBeTruthy();
      await new Promise((res) => { setTimeout(res, 300); });
      // not heard on the new socket: every relay tried, each once (the safe side), never the primary twice
      expect({ A: A.owTo(to) - before.A, B: B.owTo(to) - before.B }).toEqual({ A: 1, B: 1 });
    } finally {
      await anna.shutdown(); await bram.shutdown(); await A.R.stop(); await B.R.stop();
    }
  }, 30_000);
});
