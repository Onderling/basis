/**
 * `connectRelay` must not report success before the relay is actually usable.
 *
 * `RelayTransport.connect()` only REQUESTS the socket — it deliberately does not await it, so
 * `agent.start()` never blocks on a relay that may be unreachable. Right for boot; wrong for everyone
 * else, because it left two facts disagreeing:
 *
 *   • `sa.relay.status` said 'connected' the instant `connect()` returned;
 *   • `transport.canReach()` reads the actual socket, and still said no.
 *
 * Routing believes `canReach`, so it correctly skipped the relay. Callers believed `status`, so they
 * thought they were on it. On hardware that cost 15 seconds on every join: the dial reported success,
 * the redeem routed over NKN because the relay was not open yet, it burned the full HI timeout, and only
 * then failed over to the relay that had come up meanwhile and answered instantly (S4, 2026-07-29).
 *
 * `connectRelay` now waits for the socket. This file pins the half that can be tested without a relay
 * server — that the wait is BOUNDED. The other half (a socket that really is open when connect resolves)
 * is pinned in `packages/relay/test/relayConnectReadiness.test.js`, which has a real relay to point at;
 * this package does not depend on `@onderling/relay`.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';

describe('connectRelay waits for the socket, but never indefinitely', () => {
  it('an unreachable relay still returns — bounded, never a hang', async () => {
    const a = await createSecureAgent({
      vault: new VaultMemory(), warnOnInsecure: false,
      relayReadyTimeoutMs: 300,          // keep the test quick; production waits longer
    });
    try {
      const t0 = Date.now();
      await a.relay.connect({ relayUrl: 'ws://127.0.0.1:1' }).catch(() => { /* connect may reject */ });
      const waited = Date.now() - t0;
      expect(waited, 'a dead relay hung the caller past its bound').toBeLessThan(3_000);
    } finally {
      await a.shutdown();
    }
  });

  it('the bound is configurable, so a slow relay is a product decision rather than a magic number', async () => {
    const a = await createSecureAgent({
      vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 50,
    });
    try {
      const t0 = Date.now();
      await a.relay.connect({ relayUrl: 'ws://127.0.0.1:1' }).catch(() => {});
      expect(Date.now() - t0).toBeLessThan(2_000);
    } finally {
      await a.shutdown();
    }
  });
});
