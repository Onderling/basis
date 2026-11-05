/**
 * A DROP IN THE RECEIVE PATH SAYS WHY. The receive boundary drops an envelope silently toward the SENDER on purpose (an
 * attacker learns nothing) — but it must not be silent toward US: a statement that reached a member's socket and was
 * dropped before their router, with no line anywhere, cost two days to find. Every drop branch (muted sender, a circle
 * that blocks them, over the rate limit) logs once per reason and sender and is counted in the security status.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('a dropped inbound envelope says why', () => {
  it('over the rate limit: one line naming the reason and the sender, and a count', async () => {
    const lines = [];
    vi.spyOn(console, 'info').mockImplementation((...a) => { lines.push(a.map(String).join(' ')); });
    const bus = new InternalBus();
    const receiver = await createSecureAgent({
      vault: new VaultMemory(), warnOnInsecure: false,
      rateLimit: { perPeer: { burst: 2, refillPerSec: 0 }, global: false },
      onPeerMessage: () => {},
    });
    const sender = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });
    await receiver.addSecureTransport('relay', new InternalTransport(bus, receiver.identity.pubKey));
    await sender.addSecureTransport('relay', new InternalTransport(bus, sender.identity.pubKey));
    for (let i = 0; i < 8; i += 1) await sender.peer.sendTo(receiver.identity.pubKey, { subtype: 'test-plain', i });
    await new Promise((r) => setTimeout(r, 300));
    const said = lines.filter((l) => /dropped an inbound envelope/.test(l) && /rate-limited/.test(l));
    expect(said, `no line for the rate-limited drops: ${JSON.stringify(lines.slice(-6))}`).toHaveLength(1);
    // an operator log names a sender by a short suffix, never a near-identifying prefix of their address
    expect(said[0]).toContain(`…${sender.identity.pubKey.slice(-6)}`);
    expect(said[0]).not.toContain(sender.identity.pubKey.slice(0, 12));
    expect(receiver.securityStatus?.().receiveDrops?.['rate-limited'] ?? 0).toBeGreaterThan(0);
    await sender.shutdown();
    await receiver.shutdown();
  });
});
