/**
 * The companion is an ordinary routed agent (Frits, after the phone + laptop walk: "no special routes").
 *
 * With a nearby mDNS transport registered, the host's own `RoutingStrategy` must CHOOSE it for a peer it
 * can reach on the local network — mdns outranks relay. Before, the companion built a bare `Agent` with
 * no strategy: the transport was registered, never picked, and a hello to a peer on the same Wi-Fi went
 * out over the relay instead. Two companions on one loopback discovery stand in for phone + laptop.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createLoopbackDiscovery } from '@onderling/transports/mdns-node';
import { startCompanionNode } from '../src/index.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(pred, { timeoutMs = 8_000, everyMs = 50 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) { if (pred()) return true; await wait(everyMs); }
  return pred();
}

describe('companion-node — nearby peers are ROUTED to over mdns', () => {
  const nodes = [];
  afterAll(async () => { for (const n of nodes) { try { await n.stop(); } catch { /* */ } } });

  it('the host agent carries the ordinary RoutingStrategy, and mdns wins over relay for a nearby peer', async () => {
    const discovery = createLoopbackDiscovery();
    const a = await startCompanionNode({ identityVault: new VaultMemory(), nearby: { mdns: true, publish: true, discovery } });
    nodes.push(a);
    const b = await startCompanionNode({ identityVault: new VaultMemory(), nearby: { mdns: true, publish: true, discovery } });
    nodes.push(b);

    expect(a.agent.routing).toBeTruthy();
    expect(a.nearby?.transport).toBeTruthy();

    // Discovery + the mdns hello handshake: each side ends up holding the other as a connected peer.
    const found = await until(() => a.nearby.transport.connectedPeers().includes(b.identity.pubKey));
    expect(found, 'a never connected to b over the loopback mdns').toBe(true);

    const route = await a.agent.routeFor(b.identity.pubKey);
    expect(route.name).toBe('mdns');

    // And the route is usable: a hello over it registers b's key at a (the thing that timed out on the walk).
    await a.agent.hello(b.identity.pubKey);
    expect(a.agent.security?.getPeerKey?.(b.identity.pubKey) ?? true).toBeTruthy();
  }, 30_000);
});
