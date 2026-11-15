/**
 * A FLUSH ATTEMPTS HELD-FOR ADDRESSES SIDE BY SIDE, BOUNDED. The flush on (re)connect walked the held addresses one by
 * one, so K unreachable addresses cost K handshake waits in a row (measured: K = 6 at a 300 ms timeout, 1831 ms; ~15 s
 * each on a phone). Now at most `flushParallelAddresses` addresses at once; an address's OWN messages still go one after
 * another, oldest first. And THIS device being connected again (`connectivityRestored`, what the relay's 'connect' runs)
 * clears the not-yet clocks: a failure while it had no connection says nothing about a peer.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const TIMEOUT = 300;
const HOLD = { firstSendTimeoutMs: TIMEOUT, retryDelays: [], guarantee: 'hold-forward' };

class BlackHole extends InternalTransport {
  constructor(bus, addr) { super(bus, addr); this.puts = 0; }
  canReach() { return true; }
  async _put(to, env) { this.puts += 1; return super._put(to, env); }
}

async function onBlackHole(extra = {}) {
  const a = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, holdMaxDeliveryFailures: 50, ...extra });
  const tx = new BlackHole(new InternalBus(), a.identity.pubKey);
  await a.addSecureTransport('relay', tx);
  return { a, tx };
}
const addrs = (k, tag) => Array.from({ length: k }, (_, i) => `${tag}-${String(i).padStart(30, '0')}`);
async function perAttempt() {
  const { a, tx } = await onBlackHole();
  await a.peer.sendTo('probe-one-attempt-0000000000000000000000', { msgId: 'p' }, HOLD);
  const n = tx.puts; await a.shutdown(); return n;
}

describe('a flush attempts held-for addresses side by side, bounded', () => {
  it('K = 6 unreachable addresses: the flush takes under 2 waits (it was 6 in a row)', async () => {
    const { a, tx } = await onBlackHole({ flushParallelAddresses: 4 });
    for (const r of addrs(6, 'six')) await a.peer.sendTo(r, { msgId: `${r}-1` }, HOLD);
    const p0 = tx.puts; const t0 = Date.now();
    await a.flushHeld();
    const ms = Date.now() - t0;
    expect(ms, `wall ${ms} ms`).toBeLessThan(2 * TIMEOUT + 150);
    expect(tx.puts - p0, 'every address was attempted (one failing does not stop the others)').toBe(6 * await perAttempt());
    await a.shutdown();
  }, 30_000);

  it('K = 12: three batches of four, the bound holds (under 3 waits and a margin, not 12)', async () => {
    const { a } = await onBlackHole({ flushParallelAddresses: 4 });
    for (const r of addrs(12, 'twelve')) await a.peer.sendTo(r, { msgId: `${r}-1` }, HOLD);
    const t0 = Date.now();
    await a.flushHeld();
    const ms = Date.now() - t0;
    expect(ms, `wall ${ms} ms`).toBeGreaterThanOrEqual(3 * TIMEOUT - 50);   // bounded: never all twelve at once
    expect(ms, `wall ${ms} ms`).toBeLessThan(4 * TIMEOUT + 150);
    await a.shutdown();
  }, 30_000);

  it('an address holding several messages costs ONE attempt per flush, and keeps its messages in order', async () => {
    const one = await perAttempt();
    const { a, tx } = await onBlackHole({ flushParallelAddresses: 4, notYetAttemptIntervalMs: 0 });
    const X = 'one-address-several-messages-0000000000000';
    for (const id of ['x1', 'x2', 'x3', 'x4']) await a.peer.sendTo(X, { msgId: id }, HOLD);
    const p0 = tx.puts;
    await a.flushHeld();
    expect(tx.puts - p0, 'one attempt for the address, not four').toBe(one);
    expect(a.heldFor(X)).toBe(4);
    await a.shutdown();
  }, 30_000);

  it('a reconnect during a flush: no extra wire attempt for an address being flushed, and all its messages stay held', async () => {
    // the first flush took X's queue (x1, x2) and is waiting on x1; x3 is held for X meanwhile; a second flush (a
    // reconnect during the flush) skips X while it is being flushed (`flushingNow`). NOTE: this test is green without that
    // guard too (measured): the per-peer handshake coalescing absorbs a second attempt's HI, so the black hole cannot see
    // it; the guard is there for ORDER (x3 must not go beside x2), which needs a live receiver and timing to show
    const one = await perAttempt();
    const { a, tx } = await onBlackHole({ flushParallelAddresses: 4, notYetAttemptIntervalMs: 60_000 });
    const X = 'flushing-address-000000000000000000000000';
    for (const id of ['x1', 'x2']) await a.peer.sendTo(X, { msgId: id }, HOLD);
    const p0 = tx.puts;
    const first = a.flushHeld();
    await new Promise((r) => { setTimeout(r, 30); });                 // x1 is on the wire now
    expect((await a.peer.sendTo(X, { msgId: 'x3' }, HOLD)).held).toBe(true);   // held: the flush's attempt was X's one
    const second = a.flushHeld();
    await Promise.all([first, second]);
    expect(tx.puts - p0, 'one attempt for X, not a second one beside it').toBe(one);
    expect(a.heldFor(X)).toBe(3);
    await a.shutdown();
  }, 30_000);

});

describe('order within one address is kept', () => {
  it('two receivers away, three messages each held; on the flush each receives its own oldest first', async () => {
    const R = await startRelay({ port: 0, log: false });
    const url = `ws://127.0.0.1:${R.port}`;
    const got = { b: [], c: [] };
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, flushParallelAddresses: 4 });
    const bram = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => got.b.push(m?.payload?.msgId ?? m?.msgId) });
    const cora = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000, onPeerMessage: (m) => got.c.push(m?.payload?.msgId ?? m?.msgId) });
    try {
      await anna.relay.connect({ relayUrl: url, awaitReady: true });
      anna.setTransportMode('relay');
      const SEND = { firstSendTimeoutMs: 400, retryDelays: [], guarantee: 'hold-forward' };
      for (const id of ['b1', 'b2', 'b3']) expect((await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'note', msgId: id }, SEND)).held).toBe(true);
      for (const id of ['c1', 'c2', 'c3']) expect((await anna.peer.sendTo(cora.identity.pubKey, { subtype: 'note', msgId: id }, SEND)).held).toBe(true);
      await bram.relay.connect({ relayUrl: url, awaitReady: true }); bram.setTransportMode('relay');
      await cora.relay.connect({ relayUrl: url, awaitReady: true }); cora.setTransportMode('relay');
      await anna.flushHeld();
      const until = async (pred) => { const t = Date.now(); while (Date.now() - t < 8000 && !pred()) await new Promise((r) => { setTimeout(r, 25); }); };
      await until(() => got.b.length >= 3 && got.c.length >= 3);
      expect(got.b.filter((x) => String(x).startsWith('b'))).toEqual(['b1', 'b2', 'b3']);
      expect(got.c.filter((x) => String(x).startsWith('c'))).toEqual(['c1', 'c2', 'c3']);
    } finally {
      await anna.shutdown(); await bram.shutdown(); await cora.shutdown(); await R.close?.();
    }
  }, 60_000);
});
