/**
 * A SEND THAT ANSWERED `{delivered: false}` WAS NOT DELIVERED. `_sendWithFailover` hands back what a route answered
 * (the relay sweep's last answer when none acked; the route's own answer otherwise) rather than throwing. A held
 * message's resend and a hold-forward first send must read `delivered: false` as a failure of the address: the
 * message stays held, nothing reports it sent, and the address is not taken for alive. (Before: the resend counted it
 * as sent: dropped from the hold, `onHeldSent` fired, the address marked seen alive; the first send said delivered.)
 *
 * Measured 2026-11-16: no transport answers so today (a relay's `sendOneWay` answers nothing), so the transport here
 * is a stub that does; the two-relay case below pins what a real sweep with no ack does (it throws, and holds). In the
 * stub, bram's handshake reply is a real inbound envelope, so the address IS seen alive there (rightly); 'not taken for
 * alive' is pinned in the two-relay case, where nothing answers.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const HOLD = { firstSendTimeoutMs: 400, retryDelays: [], guarantee: 'hold-forward' };

function memoryHoldStore() {
  const bytes = new Map();
  return {
    store: { async read(uri) { return bytes.get(uri) ?? null; }, async write(uri, body) { bytes.set(uri, String(body)); } },
    alive: () => { const raw = [...bytes.values()].pop(); return raw ? JSON.parse(raw).alive ?? [] : []; },
  };
}

/** A route whose one-way send answers `{delivered: false}` while `refuse` is on (nothing leaves). */
class SaysNotDelivered extends InternalTransport {
  constructor(bus, addr) { super(bus, addr); this.refuse = false; }
  canReach() { return true; }
  async sendOneWay(to, payload, o) {
    if (this.refuse && payload?.msgId) return { delivered: false, reason: 'no-ack' };
    return super.sendOneWay(to, payload, o);
  }
}

describe('a send that answered delivered: false is not a delivery', () => {
  async function setUp() {
    const bus = new InternalBus();
    const h = memoryHoldStore();
    const sent = [];
    const received = [];
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, holdStore: h.store, onHeldSent: (e) => sent.push(e), holdMaxDeliveryFailures: 50 });
    const tx = new SaysNotDelivered(bus, anna.identity.pubKey);
    await anna.addSecureTransport('relay', tx);
    const B = await AgentIdentity.generate(new VaultMemory());
    const bram = await createSecureAgent({ vault: new VaultMemory(), identity: B, warnOnInsecure: false, onPeerMessage: (m) => received.push(m?.payload?.msgId) });
    await bram.addSecureTransport('relay', new InternalTransport(bus, B.pubKey));
    const close = async () => { await anna.shutdown(); await bram.shutdown(); };
    return { anna, tx, B: B.pubKey, sent, received, h, close };
  }

  it('a hold-forward first send that answered delivered: false is held, not reported delivered', async () => {
    const s = await setUp();
    try {
      s.tx.refuse = true;
      const r = await s.anna.peer.sendTo(s.B, { subtype: 'note', msgId: 'f1' }, HOLD);
      expect(r.delivered, `answered ${JSON.stringify({ held: r.held, delivered: r.delivered })}`).toBe(false);
      expect(r.held).toBe(true);
      expect(s.anna.heldFor(s.B)).toBe(1);
    } finally { await s.close(); }
  }, 30_000);

  it("a held message's resend that answered delivered: false stays held: not reported sent, the address not alive", async () => {
    const s = await setUp();
    try {
      s.tx.refuse = true;
      expect((await s.anna.peer.sendTo(s.B, { subtype: 'note', msgId: 'h1' }, HOLD)).held).toBe(true);
      await s.anna.flushHeld();
      expect(s.anna.heldFor(s.B), 'still held after the flush').toBe(1);
      expect(s.sent, 'nothing reported sent').toEqual([]);
      // the route delivers again: the next flush sends it and says so
      s.tx.refuse = false;
      await s.anna.flushHeld();
      expect(s.anna.heldFor(s.B)).toBe(0);
      expect(s.sent.map((e) => e.msgId)).toEqual(['h1']);
    } finally { await s.close(); }
  }, 30_000);
});

describe('a real two-relay sweep with no ack', () => {
  it('a hold-forward first send to a peer on neither relay is held, not reported delivered', async () => {
    const A = await startRelay({ port: 0, log: false });
    const Bx = await startRelay({ port: 0, log: false });
    const h = memoryHoldStore();
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, holdStore: h.store });
    const away = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    try {
      await anna.relay.connect({ relayUrl: `ws://127.0.0.1:${A.port}`, awaitReady: true });
      await anna.relays.add(`ws://127.0.0.1:${Bx.port}`, { awaitReady: true });
      anna.setTransportMode('relay');
      const r = await anna.peer.sendTo(away, { subtype: 'note', msgId: 'r1' }, HOLD);
      expect(r.delivered).toBe(false);
      expect(r.held).toBe(true);
      await anna.outboxFlushed();
      expect(h.alive()).not.toContain(away);
    } finally { await anna.shutdown(); await A.close?.(); await Bx.close?.(); }
  }, 30_000);
});
