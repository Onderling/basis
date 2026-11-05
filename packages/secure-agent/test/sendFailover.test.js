/**
 * @onderling/secure-agent — Phase-2 · Piece-1 (C1 + G4) failover tests.
 *
 * Proves the folded, single routing owner drives REAL failover on the
 * secure send path:
 *   - a TRANSPORT-CLASS error on the first-picked transport calls
 *     `routing.onTransportFailure(peer, name)`, re-routes to the next tier
 *     (relay → NKN), and the resend succeeds — "try relay, else NKN" is
 *     automatic;
 *   - an APPLICATION/skill error does NOT trigger a re-route (a different
 *     transport can't fix it);
 *   - the attempt budget bounds retries so a truly-unreachable peer can't
 *     spin, then the error falls through to the caller's hold/error path.
 *
 * Injected fake transports (no NKN/relay sockets) keep this deterministic —
 * no vite / playwright / relay processes are started (the e2e harness is
 * flaky + holds :5273).
 */
import { describe, it, expect, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';

const PEER = 'app.peer.failover';

/**
 * A minimal Transport-shaped fake the secure-mesh can inject + secure.
 * `sendOneWay` throws whatever `failWith()` returns (or records the send).
 */
function fakeTransport(name, { failWith = null } = {}) {
  return {
    address: `${name}.addr`,
    sends:  [],
    hellos: [],
    _secured: null,
    useSecurityLayer(layer) { this._secured = layer; },
    on() { /* 'envelope' listener — unused in these send-only tests */ },
    async connect()    { /* no-op */ },
    async disconnect() { /* no-op */ },
    async sendHello(to, payload) { this.hellos.push({ to, payload }); },
    async sendOneWay(to, payload) {
      if (typeof failWith === 'function') {
        const err = failWith();
        if (err) throw err;
      }
      this.sends.push({ to, payload });
      return { ok: true };
    },
    // no canReach() → address-agnostic (always reachable)
  };
}

/**
 * Build a secure agent with two injected transports — relay (higher
 * priority) + nkn (lower / always-on bottom tier).  Returns the sa plus
 * the two fakes so tests can assert which one carried the send.
 */
async function twoTransportAgent({ relayFail = null, nknFail = null } = {}) {
  const sa = await createSecureAgent({ vault: new VaultMemory() });
  const relay = fakeTransport('relay', { failWith: relayFail });
  const nkn   = fakeTransport('nkn',   { failWith: nknFail });
  await sa.addSecureTransport('relay', relay);   // relay > nkn in TRANSPORT_PRIORITY
  await sa.addSecureTransport('nkn',   nkn);      // registers on the shared router; mode → 'both'
  return { sa, relay, nkn };
}

// Send opts that keep the test fast + deterministic: no HI wait, no outer
// handshake-retry backoff — we're exercising the failover loop, not races.
const FAST = { firstSendTimeoutMs: 0, retryDelays: [] };

describe('secure-agent send failover (Phase-2 · Piece-1 — C1 + G4)', () => {
  it('a transport-class failure drives onTransportFailure + re-routes to the next tier (relay → NKN)', async () => {
    const { sa, relay, nkn } = await twoTransportAgent({
      relayFail: () => new Error('ECONN: relay socket closed'),   // transport-class
    });
    const spy = vi.spyOn(sa.agent.routing, 'onTransportFailure');

    // relay is highest priority → picked first → its sendOneWay throws →
    // failover degrades it + resends over nkn.
    await sa.peer.sendTo(PEER, { type: 'p2p-chat', body: 'hi' }, FAST);

    // relay: HI went out, but its one-way send threw (nothing recorded).
    expect(relay.hellos.length).toBe(1);
    expect(relay.sends.length).toBe(0);
    // failover drove the shared router's onTransportFailure for the peer+relay.
    expect(spy).toHaveBeenCalledWith(PEER, 'relay');
    expect(sa.agent.routing.fallbackTable.isDegraded(PEER, 'relay')).toBe(true);
    // nkn carried the resend — after introducing us ON NKN: a hello is per route (the peer on another route has
    // never seen us introduced there; a hello over the relay says nothing about nkn).
    expect(nkn.sends.length).toBe(1);
    expect(nkn.sends[0].payload).toEqual({ type: 'p2p-chat', body: 'hi' });
    expect(nkn.hellos.length).toBe(1);

    spy.mockRestore();
    await sa.shutdown();
  });

  it('an APPLICATION/skill error does NOT re-route (bubbles unchanged)', async () => {
    const { sa, relay, nkn } = await twoTransportAgent({
      relayFail: () => Object.assign(new Error('skill rejected input'), { name: 'SkillError' }),
    });
    const spy = vi.spyOn(sa.agent.routing, 'onTransportFailure');

    await expect(sa.peer.sendTo(PEER, { type: 'p2p-chat' }, FAST))
      .rejects.toThrow(/skill rejected input/);

    // No failover: nkn was never tried, relay was never degraded.
    expect(nkn.hellos.length).toBe(0);
    expect(nkn.sends.length).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(sa.agent.routing.fallbackTable.isDegraded(PEER, 'relay')).toBe(false);

    spy.mockRestore();
    await sa.shutdown();
  });

  it('the attempt budget bounds the retries — budget:1 tries one transport then gives up', async () => {
    const { sa, relay, nkn } = await twoTransportAgent({
      relayFail: () => new Error('ECONN: relay socket closed'),   // transport-class
      nknFail:   () => new Error('ECONN: nkn dial timeout'),      // transport-class
    });
    const spy = vi.spyOn(sa.agent.routing, 'onTransportFailure');

    // With a budget of 1, exactly ONE transport is attempted before the
    // error propagates — no spin across tiers.
    await expect(sa.peer.sendTo(PEER, { type: 'p2p-chat' }, { ...FAST, failoverBudget: 1 }))
      .rejects.toThrow(/relay socket closed/);

    expect(relay.hellos.length).toBe(1);   // relay attempted once
    expect(spy).toHaveBeenCalledTimes(1);  // degraded once, then stopped
    expect(nkn.hellos.length).toBe(0);     // budget spent → nkn never tried
    expect(nkn.sends.length).toBe(0);

    spy.mockRestore();
    await sa.shutdown();
  });

  it('with the default budget, both tiers failing degrades both then falls to error (no spin)', async () => {
    const { sa, relay, nkn } = await twoTransportAgent({
      relayFail: () => new Error('ECONN: relay socket closed'),
      nknFail:   () => new Error('ECONN: nkn dial timeout'),
    });

    await expect(sa.peer.sendTo(PEER, { type: 'p2p-chat' }, FAST))
      .rejects.toThrow(/ECONN/);

    // Each distinct transport tried exactly once (the tried-set stops the
    // loop when the router has no fresh tier), both degraded, then error.
    // A hello per route: one on the relay (attempt 1), one on nkn (the resend introduces us there first); both
    // being DEGRADED is the proof both were attempted.
    expect(relay.hellos.length).toBe(1);
    expect(nkn.hellos.length).toBe(1);
    expect(sa.agent.routing.fallbackTable.isDegraded(PEER, 'relay')).toBe(true);
    expect(sa.agent.routing.fallbackTable.isDegraded(PEER, 'nkn')).toBe(true);

    await sa.shutdown();
  });
});
