/**
 * First contact must follow the canonical transport priority.
 *
 * `routeUnscoped` asks the shared RoutingStrategy first, and falls back to a static choice when the
 * strategy cannot decide. "Cannot decide" reads like a rare corner — it is not. A peer nobody has spoken
 * to yet has no PeerGraph entry and no latency history, so first contact is exactly when it runs.
 *
 * That fallback hardcoded "prefer NKN then relay", which contradicts `TRANSPORT_PRIORITY`, where relay
 * ranks above nkn. Nothing enforced the agreement, so the two could drift apart silently — and NKN is
 * the slowest transport available, so drifting in that direction is expensive: a first contact over NKN
 * waits the full HI timeout before it fails over.
 *
 * Asserted through the failover log, because that is where the choice becomes observable from outside:
 * the order in which transports are reported failing IS the order they were tried.
 */
import { describe, it, expect, vi } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, TRANSPORT_PRIORITY } from '@onderling/core';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 200, retryDelays: [] };
const agent = () => createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false });

/** Reports it can reach anyone — a relay's real, address-agnostic behaviour. */
class Reachable extends InternalTransport {
  canReach() { return true; }
}

/** The transports named in `[secure-agent] transport "X" failed …`, in the order they were tried. */
async function attemptOrder(a, peer) {
  const lines = [];
  const spy = vi.spyOn(console, 'info').mockImplementation((...args) => lines.push(args.join(' ')));
  try {
    await a.peer.sendTo(peer, { subtype: 'group-redeem-request' }, FAST);
  } catch { /* nobody is listening — the ORDER is the point */ } finally {
    spy.mockRestore();
  }
  return lines
    .map((l) => /transport "([^"]+)" failed/.exec(l)?.[1])
    .filter(Boolean);
}

describe('first contact follows TRANSPORT_PRIORITY', () => {
  it('relay is tried before nkn', async () => {
    const anna = await agent();
    const stranger = (await agent()).identity.pubKey;   // no graph entry, no history
    await anna.addSecureTransport('nkn',   new Reachable(new InternalBus(), anna.identity.pubKey));
    await anna.addSecureTransport('relay', new Reachable(new InternalBus(), anna.identity.pubKey));

    const order = await attemptOrder(anna, stranger);
    expect(order.length, 'nothing was attempted at all').toBeGreaterThan(0);
    expect(order[0], 'first contact went out over NKN, the slowest transport available').toBe('relay');
    await anna.shutdown();
  });

  it('nkn is still used when it is the only transport — the order degrades, it does not refuse', async () => {
    const anna = await agent();
    const stranger = (await agent()).identity.pubKey;
    await anna.addSecureTransport('nkn', new Reachable(new InternalBus(), anna.identity.pubKey));

    const order = await attemptOrder(anna, stranger);
    expect(order[0]).toBe('nkn');
    await anna.shutdown();
  });

  it('the priority table itself still ranks relay above nkn — the premise of the fallback', () => {
    expect(TRANSPORT_PRIORITY.indexOf('relay')).toBeLessThan(TRANSPORT_PRIORITY.indexOf('nkn'));
  });
});
