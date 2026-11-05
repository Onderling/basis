/**
 * A PERSONA'S SEND IS HELD LIKE ANY OTHER. A send as a persona that cannot go out now (no socket of its own yet, or the
 * peer unreachable) is held on hold-forward, as the general persona's would be — and every flush re-sends it as the
 * persona, on the persona's own sockets ONLY. A flush that sent it on the general persona's socket would show the relay
 * that the two are one device: the very link a persona exists to prevent. With no socket of its own it waits.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 2500, retryDelays: [] };
const agent = (onPeerMessage, extra = {}) => createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false, relayReadyTimeoutMs: 3000, ...extra });
async function until(pred, { timeout = 5000, step = 20 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = pred(); if (v) return v; await new Promise((r) => setTimeout(r, step)); }
  return pred();
}

describe("a persona's send is held, and flushed only as the persona", () => {
  it('held while the persona has no socket; a flush then sends nothing on the default socket; once it dials, it arrives as the persona', async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const received = [];
    const sentAfterHold = [];
    const anna = await agent(undefined, { onHeldSent: (e) => sentAfterHold.push(e) });
    const bram = await agent((m) => received.push(m));
    const persona = await AgentIdentity.generate(new VaultMemory());
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      await bram.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay'); bram.setTransportMode('relay');
      expect(anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey })).toBe(true);

      const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'as the persona', msgId: 'p1' }, { ...FAST, sendAs: persona.pubKey, guarantee: 'hold-forward' });
      expect(r.held, `the persona's send is held, not lost: ${JSON.stringify(r)}`).toBe(true);
      expect(anna.heldFor(bram.identity.pubKey)).toBe(1);

      // a flush while the persona still has no socket: nothing goes out — least of all on the default's socket
      await anna.flushHeld();
      await new Promise((res) => setTimeout(res, 800));
      expect(received.filter((m) => m.payload?.text === 'as the persona'), 'it left on another identity\'s socket').toEqual([]);
      expect(sentAfterHold, 'a flush that sent nothing reports nothing').toEqual([]);
      expect(anna.heldFor(bram.identity.pubKey), 'and it is still held').toBe(1);

      // the persona dials; the next flush sends it, as the persona
      await anna.relays.add(url, { identity: persona, awaitReady: true });
      await anna.flushHeld();
      const got = await until(() => received.find((m) => m.payload?.text === 'as the persona'));
      expect(got, 'it arrived').toBeTruthy();
      expect(got.from, 'as the persona').toBe(persona.pubKey);
      expect(anna.heldFor(bram.identity.pubKey)).toBe(0);
      // …and the outbox SAYS it went: what lets the bubble move on from waiting
      expect(sentAfterHold.map((e) => e.msgId), 'the held message going out was reported').toEqual(['p1']);
      expect(sentAfterHold[0].addr).toBe(bram.identity.pubKey);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await R.close?.();
    }
  }, 30_000);

  it("a restored outbox flushed before the persona registers again still never sends it on the default's socket", async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const received = [];
    const bytes = new Map();
    const holdStore = { async read(uri) { return bytes.get(uri) ?? null; }, async write(uri, body) { bytes.set(uri, String(body)); } };
    const persona = await AgentIdentity.generate(new VaultMemory());
    const identity = await AgentIdentity.generate(new VaultMemory());
    const vault = new VaultMemory();
    const bram = await agent((m) => received.push(m));
    let anna = await createSecureAgent({ vault, identity, warnOnInsecure: false, relayReadyTimeoutMs: 3000, holdStore });
    try {
      await bram.relay.connect({ relayUrl: url, awaitReady: true });
      bram.setTransportMode('relay');
      anna.registerSelfIdentity(persona.pubKey, persona, { owner: persona.pubKey });
      expect((await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', text: 'restored', msgId: 'p2' }, { ...FAST, sendAs: persona.pubKey, guarantee: 'hold-forward' })).held).toBe(true);
      await anna.outboxFlushed();
      await anna.shutdown();
      // the restart: the outbox comes back, the default socket connects (which flushes), the persona is not registered yet
      anna = await createSecureAgent({ vault, identity, warnOnInsecure: false, relayReadyTimeoutMs: 3000, holdStore });
      await anna.outboxRestored();
      expect(anna.heldFor(bram.identity.pubKey), 'the outbox restored it').toBe(1);
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay');
      await anna.flushHeld();
      await new Promise((res) => setTimeout(res, 800));
      expect(received.filter((m) => m.payload?.text === 'restored'), "it left on the default's socket").toEqual([]);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await R.close?.();
    }
  }, 30_000);
});
