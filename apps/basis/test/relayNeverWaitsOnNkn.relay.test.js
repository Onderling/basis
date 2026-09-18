/**
 * THE RELAY NEVER WAITS ON NKN.
 *
 * The web app dials both when the NKN SDK loaded from its CDN and a relay is configured — and it dialled
 * them IN ORDER: `await` NKN, then the relay. NKN's public network was unreachable from Frits' browser on
 * 2026-09-18 ("connect to node timeout" ×4, "All clients connect failed"); the transport's own fallback
 * chain (MultiClient → Client → seedless, 90 s each) ran for minutes, then threw, and the relay — the
 * alpha's ONE default transport, the box's only road to him — was never dialled at all. The settings
 * panel meanwhile said "connected", because that word only meant "a relay URL is configured".
 *
 * The claim: with a relay configured, `connectPeerTransport` brings the relay up FIRST and promptly, no
 * matter what NKN does — hangs, or throws — and NKN's outcome is a log line, never the relay's fate.
 * Without a relay, NKN is awaited as before (the NKN-only walks keep their contract).
 *
 * Real relay, real agent; NKN faked in the two shapes seen: a client that never connects, and one that
 * fails outright.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';
import { VaultMemory } from '@onderling/vault';
import { startJourneyRelay } from './support/testRelay.js';
import { bootRealAgentNode, until, teardown } from './support/pairRealAgents.js';

/** An nkn-sdk look-alike whose clients never reach 'connect' — the unreachable-network shape. */
const nknThatHangs = () => {
  class Client extends EventEmitter { constructor() { super(); this.addr = null; } close() {} }
  return { Client, MultiClient: Client };
};
/** …and one whose construction fails outright — "All clients connect failed". */
const nknThatThrows = () => {
  class Client { constructor() { throw new Error('All clients connect failed'); } }
  return { Client, MultiClient: Client };
};

describe('a configured relay comes up promptly whatever NKN does', () => {
  let relay; const nodes = [];
  beforeAll(async () => { relay = await startJourneyRelay(); });
  afterAll(async () => { await teardown(...nodes); try { await relay?.close?.(); } catch { /* */ } });

  const boot = async (label) => {
    const n = await bootRealAgentNode(label, { agentOpts: { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory() } });
    nodes.push(n);
    return n;
  };

  it('NKN hangs (never connects): the relay is registered within seconds and the call returns', async () => {
    const n = await boot('hang');
    const t0 = Date.now();
    await n.agent.connectPeerTransport({ nknLib: nknThatHangs(), relayUrl: relay.url, onPeerMessage: () => {} });
    const took = Date.now() - t0;
    expect(took, 'connectPeerTransport returned without waiting out NKN').toBeLessThan(10_000);
    const up = await until(async () => (n.agent.relay?.status === 'connected' ? true : null), { timeout: 10_000, step: 100 });
    expect(up, 'the relay socket is open').toBe(true);
  }, 30_000);

  it('NKN throws at construction: the relay still comes up, nothing propagates', async () => {
    const n = await boot('throw');
    await expect(n.agent.connectPeerTransport({ nknLib: nknThatThrows(), relayUrl: relay.url, onPeerMessage: () => {} })).resolves.not.toThrow();
    const up = await until(async () => (n.agent.relay?.status === 'connected' ? true : null), { timeout: 10_000, step: 100 });
    expect(up, 'the relay socket is open').toBe(true);
  }, 30_000);
});
