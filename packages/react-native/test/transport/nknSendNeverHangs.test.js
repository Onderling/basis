/**
 * A wire send must SETTLE — a transport that hangs disables the failover above it.
 *
 * Found on hardware 2026-07-30 while chasing the message round-trip, and it is the most expensive shape of
 * bug in this codebase: not a wrong answer, but no answer.
 *
 * `nkn-sdk`'s `client.send()` waits for the client to become ready and never times out on its own, and
 * `_put` guarded only on `#client` EXISTING — which it does from construction, up to ~90 s before it can
 * actually be connected (the transport's own comment says NKN "can take up to 90 s on some nodes"). So every
 * HI issued while the mesh was coming up hung forever. On the phone: **812** `sending outbound HI`, **11**
 * `outbound HI sent OK`, and **zero** failures — 801 promises that never settled either way.
 *
 * The damage was upstream. `secure-agent`'s `announceHi()` awaits this call, so `_sendOverRoute` never
 * returned, its own 5 s/15 s HI wait never ran, and `RoutingStrategy` never failed over. The relay was
 * connected and working the entire time and could not be reached — because the transport that was DOWN never
 * said no. A transport that fails is routable around; a transport that hangs is not.
 *
 * Hence two independent guarantees, tested separately because either alone leaves the hole open:
 *   1. refuse while the client is constructed-but-not-connected, and
 *   2. bound every send, so even a client that reports connected cannot wedge us.
 */
import { describe, it, expect, vi } from 'vitest';
import { NknTransport } from '../../src/transport/NknTransport.js';

const identity = { pubKey: 'a'.repeat(64), sign: async () => 'sig' };

/**
 * A fake nkn lib whose `send` never settles — the real failure mode, which no amount of retrying fixes.
 * `connectOnConstruct: false` leaves the client in the constructed-but-connecting state that `_put` used to
 * walk straight past.
 */
function hangingNkn({ connectOnConstruct = true } = {}) {
  const handle = { current: null };
  class FakeClient {
    constructor(opts) {
      this.opts = opts;
      this.addr = 'nkn-self';
      this._handlers = new Map();
      this.sendCalls = 0;
      handle.current = this;
      if (connectOnConstruct) queueMicrotask(() => this._emit('connect'));
    }
    on(evt, fn) {
      if (!this._handlers.has(evt)) this._handlers.set(evt, new Set());
      this._handlers.get(evt).add(fn);
      return this;
    }
    _emit(evt, p) { for (const fn of [...(this._handlers.get(evt) ?? [])]) fn(p); }
    /** Never resolves, never rejects. */
    send() { this.sendCalls += 1; return new Promise(() => {}); }
    close() {}
  }
  return { lib: { Client: FakeClient, MultiClient: FakeClient }, handle };
}

const settle = () => new Promise((r) => setImmediate(r));

describe('a send while the mesh is still connecting fails fast', () => {
  it('refuses instead of hanging — `#client` existing is not the same as being connected', async () => {
    const { lib } = hangingNkn({ connectOnConstruct: false });
    const tx = new NknTransport({ identity, nknLib: lib, connectTimeout: 50_000 });
    // Kick off connect but never let it complete, which is exactly the ~90 s window on a real device.
    tx.connect().catch(() => { /* it will not connect in this test */ });
    await settle();

    await expect(
      tx.sendHello('peer-1', { pubKey: identity.pubKey }),
    ).rejects.toThrow(/not connected yet/);
  });

  it('and reports itself unreachable, so routing prefers a transport that is up', async () => {
    const { lib } = hangingNkn({ connectOnConstruct: false });
    const tx = new NknTransport({ identity, nknLib: lib, connectTimeout: 50_000 });
    tx.connect().catch(() => {});
    await settle();
    expect(tx.canReach('peer-1')).toBe(false);
    expect(tx.connected).toBe(false);
  });
});

describe('a send to a connected-but-wedged client still settles', () => {
  it('rejects on the send timeout rather than hanging forever', async () => {
    vi.useFakeTimers();
    try {
      const { lib } = hangingNkn();
      const tx = new NknTransport({ identity, nknLib: lib, sendTimeoutMs: 8_000, sendRetries: 0 });
      await tx.connect();

      const sending = tx.sendHello('peer-1', { pubKey: identity.pubKey });
      // Attach the expectation BEFORE advancing, so an unhandled rejection cannot escape.
      const assertion = expect(sending).rejects.toThrow(/timed out after 8000ms/);
      await vi.advanceTimersByTimeAsync(8_500);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('the promise settles at all — the property that actually matters', async () => {
    // Stated separately from the message: the old behaviour was not a wrong error, it was NO settlement, and
    // that is what disabled every timeout and failover above this layer.
    vi.useFakeTimers();
    try {
      const { lib } = hangingNkn();
      const tx = new NknTransport({ identity, nknLib: lib, sendTimeoutMs: 3_000, sendRetries: 0 });
      await tx.connect();

      let settled = false;
      const p = tx.sendHello('peer-1', { pubKey: identity.pubKey })
        .then(() => { settled = true; }, () => { settled = true; });
      await vi.advanceTimersByTimeAsync(3_500);
      await p;
      expect(settled, 'the send never settled — nothing above can time out or fail over').toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a timeout of 0 opts out, so a caller can still choose to wait indefinitely', async () => {
    const { lib } = hangingNkn();
    const tx = new NknTransport({ identity, nknLib: lib, sendTimeoutMs: 0, sendRetries: 0 });
    await tx.connect();
    // Nothing to await here without hanging the test; assert the config is honoured by racing a short timer.
    const raced = await Promise.race([
      tx.sendHello('peer-1', { pubKey: identity.pubKey }).then(() => 'settled', () => 'settled'),
      new Promise((r) => setTimeout(() => r('still-pending'), 50)),
    ]);
    expect(raced).toBe('still-pending');
  });
});
