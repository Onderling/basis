/**
 * Transport PORT conformance harness.
 *
 * A reusable utility that, given a factory producing a *connected pair* of
 * transports, asserts the implementation satisfies the `Transport` port
 * (packages/core/src/transport/Transport.js): the required methods exist and
 * the core lifecycle behaviours the base class defines actually hold over the
 * adapter's `_put` — one-way delivery, request/response reply-correlation, and
 * AS auto-ACK.
 *
 * "Implement the port + pass this harness = compatible with the @onderling SDK."
 *
 * Usage (from a vitest test):
 *
 *   await assertTransportConformance(async () => {
 *     const bus = new InternalBus();
 *     const a = new InternalTransport(bus, 'a');
 *     const b = new InternalTransport(bus, 'b');
 *     await a.connect(); await b.connect();
 *     return { a, b, addrA: 'a', addrB: 'b',
 *       async teardown() { await a.disconnect(); await b.disconnect(); } };
 *   }, { label: 'InternalTransport' });
 *
 * The factory MUST return two transports that can already reach each other
 * (connected, and for peer-scoped transports the channel already open), plus
 * their wire addresses and an optional `teardown()`.
 */
import { expect } from 'vitest';
import { Transport } from '../transport/Transport.js';
import { P, mkEnvelope } from '../Envelope.js';

/** Methods every Transport (base + adapter) must expose. */
export const REQUIRED_TRANSPORT_METHODS = Object.freeze([
  'sendOneWay', 'publishOneWay', 'sendAck', 'request', 'respond', 'sendHello',
  'publishEnvelope', 'subscribeEnvelopes',
  'connect', 'disconnect', 'canReach', 'forgetPeer',
  'setReceiveHandler', 'useSecurityLayer',
  '_put', '_send', '_receive',
]);

/** Poll `cond` until it returns truthy or `timeout` ms elapse. */
async function waitFor(cond, timeout, label) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error(`conformance: timed out waiting for ${label}`);
}

/**
 * Assert that `makePair` yields a Transport implementation satisfying the port.
 *
 * @param {() => Promise<{
 *   a: import('../transport/Transport.js').Transport,
 *   b: import('../transport/Transport.js').Transport,
 *   addrA: string, addrB: string,
 *   teardown?: () => (void | Promise<void>),
 * }>} makePair
 * @param {object} [opts]
 * @param {string} [opts.label='transport']
 * @param {number} [opts.timeout=5000]
 */
export async function assertTransportConformance(makePair, { label = 'transport', timeout = 5000 } = {}) {
  const { a, b, addrA, addrB, teardown } = await makePair();

  try {
    // ── 1. Shape: both endpoints are Transports with the full method surface ──
    for (const [name, t] of [['a', a], ['b', b]]) {
      expect(t, `${label}[${name}]: must be a Transport instance`).toBeInstanceOf(Transport);
      for (const m of REQUIRED_TRANSPORT_METHODS) {
        expect(typeof t[m], `${label}[${name}]: must expose method ${m}()`).toBe('function');
      }
      // The one method a minimal adapter MUST override.
      expect(t._put, `${label}[${name}]: must override _put()`).not.toBe(Transport.prototype._put);
      expect(typeof t.address, `${label}[${name}]: exposes an address`).toBe('string');
    }

    // ── Wire b's inbound: record every dispatched envelope; auto-answer RQ ──
    const inbox = [];
    b.setReceiveHandler((env) => {
      inbox.push(env);
      if (env._p === P.RQ) {
        // Reply so the requester's pending promise resolves.
        b.respond(env._from, env._id, { echoed: env.payload });
      }
    });

    // ── 2. One-way delivery (OW) ──────────────────────────────────────────────
    await a.sendOneWay(addrB, { hello: 'ow' });
    await waitFor(() => inbox.some(e => e._p === P.OW && e.payload?.hello === 'ow'),
      timeout, `${label}: one-way delivery`);
    const owEnv = inbox.find(e => e._p === P.OW && e.payload?.hello === 'ow');
    expect(owEnv._from, `${label}: OW envelope carries sender address`).toBe(addrA);

    // ── 3. Request/response reply-correlation (RQ → RS) ───────────────────────
    const rs = await a.request(addrB, { q: 42 }, timeout);
    expect(rs._p, `${label}: request() resolves with an RS envelope`).toBe(P.RS);
    expect(rs.payload, `${label}: RS carries the responder's payload`)
      .toEqual({ echoed: { q: 42 } });
    // The RS was consumed by reply-correlation, NOT dispatched to the app layer.
    expect(inbox.some(e => e._p === P.RS), `${label}: RS is not double-dispatched`).toBe(false);

    // ── 4. Ack-send auto-ACK (AS → AK, AS still dispatched) ───────────────────
    const ak = await a.sendAck(addrB, { ping: 1 }, timeout);
    expect(ak._p, `${label}: sendAck() resolves with an AK envelope`).toBe(P.AK);
    await waitFor(() => inbox.some(e => e._p === P.AS && e.payload?.ping === 1),
      timeout, `${label}: AS envelope is also dispatched to the app layer`);
  } finally {
    await teardown?.();
  }
}

/**
 * SENDER BINDING — the case every transport that PROVES a sender must pass (a transport that cannot prove one,
 * like the in-process bus, has nothing to bind and is not run against it).
 *
 * A connection's sender is proven somehow — a challenged hello (mDNS), a key-proof at registration (the relay), an
 * authenticated `src` (NKN). An envelope's `_from` is only a claim, and a signature proves a key, never that the
 * key belongs at the address the envelope names. So a transport that proves who is on the other end must bind
 * `_from` to that proof: a frame claiming any other address is DROPPED, never delivered. Without it, a peer who can
 * reach you at all can speak as anyone a receiver has not yet bound (trust on first use takes the forger's key for
 * that address). The rule is the kernel's (`createSenderBinding` / `senderVerdict`); this asserts it holds over the
 * adapter's own wire.
 *
 * The factory returns a connected pair plus `forgedAddr`, an address `a` is NOT proven as. The harness pushes a
 * frame from `a` over its own connection claiming `forgedAddr` (`a._put` — below the base class, so nothing stamps
 * the real sender), then an honest one, and asserts `b` dispatched the honest frame and never the forged one.
 *
 * @param {() => Promise<{ a: object, b: object, addrA: string, addrB: string, forgedAddr: string,
 *   teardown?: () => (void|Promise<void>) }>} makePair
 * @param {object} [opts]
 * @param {string} [opts.label='transport']
 * @param {number} [opts.timeout=5000]
 */
export async function assertSenderBindingConformance(makePair, { label = 'transport', timeout = 5000 } = {}) {
  const { a, b, addrA, addrB, forgedAddr, teardown } = await makePair();
  try {
    expect(typeof forgedAddr === 'string' && forgedAddr && forgedAddr !== addrA,
      `${label}: the factory names an address a is not`).toBe(true);
    const inbox = [];
    b.setReceiveHandler((env) => { inbox.push(env); });
    const forged = mkEnvelope(P.OW, forgedAddr, addrB, { forged: true });
    const forgedId = forged._id;
    try { await a._put(addrB, forged); } catch { /* a transport may refuse it at the sender's side too — that also binds */ }
    await a.sendOneWay(addrB, { honest: true });
    await waitFor(() => inbox.some((e) => e.payload?.honest === true), timeout, `${label}: the honest frame`);
    // give a forged frame the same chance to arrive as the honest one had
    await new Promise((r) => setTimeout(r, 100));
    const honest = inbox.find((e) => e.payload?.honest === true);
    expect(honest._from, `${label}: the honest frame names its sender`).toBe(addrA);
    expect(inbox.some((e) => e._id === forgedId || e._from === forgedAddr),
      `${label}: a frame claiming an address its connection is not proven as is dropped`).toBe(false);
  } finally {
    await teardown?.();
  }
}
