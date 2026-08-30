/**
 * The HI handshake is per PEER, not per message.
 *
 * Boot fans several sends at one peer; each used to open its own HI wait (15 s on a mesh transport, a
 * re-announce every 2.5 s) — in parallel, for a peer that is simply gone. Now the first send handshakes and
 * the rest join it: one wait, one series of announces, every send told the same outcome.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

/** Reachable on paper, silent in practice — and it counts what went on the wire (hellos included). */
class BlackHoleTransport extends InternalTransport {
  constructor(bus, addr) { super(bus, addr); this.puts = 0; }
  canReach() { return true; }
  async _put(to, envelope) { this.puts += 1; return super._put(to, envelope); }
}
const DEAD = 'dead-peer-address-0000000000000000000000000';
const SEND = { firstSendTimeoutMs: 300, retryDelays: [], guarantee: 'hold-forward' };

async function agentOnBlackHole() {
  const a = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
  const tx = new BlackHoleTransport(new InternalBus(), a.identity.pubKey);
  await a.addSecureTransport('relay', tx);
  return { a, tx };
}

describe('HI handshake — one in flight per peer', () => {
  it('three concurrent sends to a silent peer cost ONE hello, and all three get the same answer', async () => {
    const { a, tx } = await agentOnBlackHole();
    const results = await Promise.all([1, 2, 3].map((n) =>
      a.peer.sendTo(DEAD, { msgId: `m${n}`, text: 'hoi' }, SEND),
    ));
    expect(tx.puts).toBe(1);                                  // one HI on the wire, not three
    for (const r of results) expect(r.delivered).toBe(false);
    await a.shutdown();
  });

  it('after the shared handshake ends, a later send handshakes again (nothing is pinned as in-flight)', async () => {
    const { a, tx } = await agentOnBlackHole();
    await a.peer.sendTo(DEAD, { msgId: 'm1' }, SEND);
    const before = tx.puts;
    await a.peer.sendTo(DEAD, { msgId: 'm2' }, SEND);
    expect(tx.puts).toBeGreaterThan(before);
    await a.shutdown();
  });
});
