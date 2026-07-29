/**
 * The transport contract behind the join's 15-second stall (S4, 2026-07-29).
 *
 * `RelayTransport.connect()` returns as soon as the socket has been REQUESTED — by design, so
 * `agent.start()` never blocks on a relay that may be unreachable. The cost of that design is a window
 * in which the transport exists, `connect()` has resolved, and `canReach()` is still false.
 *
 * Routing consults `canReach`, so during that window every send quietly avoids the relay. On hardware
 * that turned a join into a 15-second wait: the redeem went over NKN, burned the full HI timeout, and
 * only then failed over to the relay — which by then was up, and answered instantly.
 *
 * `createSecureAgent.connectRelay` now waits for `connected` before reporting back. These tests pin the
 * two facts that fix depends on, so nobody "simplifies" either of them away:
 *
 *   1. `connect()` really does resolve before the socket is open — the window is real, not folklore;
 *   2. waiting on `connected` really does close it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
import { RelayTransport } from '@onderling/transports';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

let relay = null;
let tx = null;

afterEach(async () => {
  try { await tx?.disconnect(); } catch { /* */ }
  try { await relay?.stop(); } catch { /* */ }
  tx = null; relay = null;
});

async function waitForSocket(t, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && !t.connected) {
    await new Promise((r) => setTimeout(r, 25));
  }
  return t.connected;
}

describe('RelayTransport.connect() resolves BEFORE the socket is open', () => {
  it('the window is real — connect() resolves while canReach() is still false', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.generate(new VaultMemory());
    tx = new RelayTransport({ relayUrl: `ws://127.0.0.1:${relay.port}`, identity: id });

    await tx.connect();
    // If this ever starts failing because `connected` is already true, connect() has begun awaiting the
    // socket — good news, and the wait in createSecureAgent.connectRelay becomes a no-op rather than a
    // bug. Update this test rather than deleting the wait.
    expect(tx.connected, 'connect() now awaits the socket — see the comment').toBe(false);
    expect(tx.canReach('anyone'), 'canReach disagreed with connected').toBe(false);
  });

  it('waiting on `connected` closes the window, which is what the join fix relies on', async () => {
    relay = await startRelay({ port: 0 });
    const id = await AgentIdentity.generate(new VaultMemory());
    tx = new RelayTransport({ relayUrl: `ws://127.0.0.1:${relay.port}`, identity: id });

    await tx.connect();
    expect(await waitForSocket(tx), 'the socket never opened against a live relay').toBe(true);
    // …and now routing would actually choose it.
    expect(tx.canReach('anyone')).toBe(true);
  });

  it('a dead relay leaves `connected` false rather than throwing — the wait must be bounded', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    tx = new RelayTransport({ relayUrl: 'ws://127.0.0.1:1', identity: id });
    await tx.connect();
    expect(await waitForSocket(tx, 300)).toBe(false);
  });
});
