/**
 * `reachable-peers` — WHO LEARNS WHAT (audit item G7, 2026-07-27).
 *
 * The claim's body is this device's contact graph: every directly-connected peer's pubKey, signed. The
 * skill is `authenticated`, so before this change any known peer could ask a device "who are you connected
 * to?" and get a signed answer back. That is fine in a mesh demo and not fine in an app whose users are in
 * neighbourhood circles — it is strictly worse than the linkability gap G13 describes, because it does not
 * merely let an observer CORRELATE identities, it lets any peer ENUMERATE a graph on request.
 *
 * The fix scopes the ANSWER, not just the gate — the same lesson as the report-visibility decision
 * (`docs/decisions.md` 2026-07-26 §2): a gate controls who may ASK; only the data layer controls what they
 * LEARN. Core stays circle-agnostic (invariant 5), so the scoper is injected by whoever knows what a
 * circle is.
 *
 * `reachablePeers.test.js` covers the claim mechanics (ttl / seq / caching) and opts into an open scope
 * explicitly. This file covers disclosure.
 */
import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../src/Agent.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { PeerGraph } from '../src/discovery/PeerGraph.js';
import { Parts } from '../src/Parts.js';
import { registerReachablePeersSkill } from '../src/skills/reachablePeers.js';

async function makeAgent({ peers = new PeerGraph() } = {}) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent = new Agent({
    identity, peers,
    transport: new InternalTransport(new InternalBus(), identity.pubKey),
  });
  await agent.start();
  return agent;
}

async function seedPeers(graph, pks) {
  for (const pk of pks) await graph.upsert({ pubKey: pk, hops: 0, reachable: true });
  return pks;
}

/** Invoke the skill directly with a chosen caller — the handler reads `from`. */
const askAs = async (agent, from) =>
  Parts.data(await agent.skills.get('reachable-peers').handler({ parts: [], from }));

const ALL = ['pk-anna', 'pk-bram', 'pk-cato'];

describe('deny-by-default — an unconfigured oracle discloses nothing', () => {
  it('with no peerScope the claim carries NO peers', async () => {
    const peers = new PeerGraph();
    await seedPeers(peers, ALL);
    const agent = await makeAgent({ peers });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerReachablePeersSkill(agent);

    const data = await askAs(agent, 'pk-stranger');
    expect(data.body.p).toEqual([]);           // …and the graph is NOT in the payload
    expect(JSON.stringify(data)).not.toContain('pk-anna');

    // Silence would be worse than the leak: an empty claim degrades hop routing, and the operator has to
    // know that is a configuration choice rather than a network condition.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no `peerScope` configured'));
    warn.mockRestore();
    await agent.stop();
  });

  it('the warning fires ONCE, not on every call', async () => {
    const agent = await makeAgent();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    registerReachablePeersSkill(agent);
    await askAs(agent, 'a'); await askAs(agent, 'b'); await askAs(agent, 'c');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    await agent.stop();
  });
});

describe('the answer is scoped PER CALLER', () => {
  /** A stand-in for the real thing: in basis this is "peers you share a circle with". */
  const sharedCircleScope = (caller, all) => {
    const circles = { 'pk-bram': ['pk-anna'], 'pk-cato': ['pk-anna', 'pk-bram'] };
    return all.filter((p) => (circles[caller] ?? []).includes(p));
  };

  it('two callers get two different answers from the same device', async () => {
    const peers = new PeerGraph();
    await seedPeers(peers, ALL);
    const agent = await makeAgent({ peers });
    registerReachablePeersSkill(agent, { peerScope: sharedCircleScope });

    expect((await askAs(agent, 'pk-bram')).body.p).toEqual(['pk-anna']);
    expect((await askAs(agent, 'pk-cato')).body.p).toEqual(['pk-anna', 'pk-bram']);
    // A caller who shares nothing learns nothing — and cannot tell whether the device has peers at all.
    expect((await askAs(agent, 'pk-stranger')).body.p).toEqual([]);
    await agent.stop();
  });

  it('the CACHE is per caller — one caller\'s claim is never served to another', async () => {
    // The trap this guards: the original cache was a single slot keyed by the peer-set. Under per-caller
    // scoping that would hand the first caller's claim — and their view of the graph — to the next one.
    const peers = new PeerGraph();
    await seedPeers(peers, ALL);
    const agent = await makeAgent({ peers });
    registerReachablePeersSkill(agent, { peerScope: sharedCircleScope });

    await askAs(agent, 'pk-cato');                       // warms a 2-peer claim
    const bram = await askAs(agent, 'pk-bram');          // must NOT receive Cato's
    expect(bram.body.p).toEqual(['pk-anna']);
    expect(JSON.stringify(bram)).not.toContain('pk-bram');

    // …and Cato still gets his own on a repeat (the cache still works, it is just keyed correctly).
    expect((await askAs(agent, 'pk-cato')).body.p).toEqual(['pk-anna', 'pk-bram']);
    await agent.stop();
  });

  it('a scoper cannot INVENT peers — it may only narrow', async () => {
    // Defence against a buggy or hostile scoper: the claim is signed by this device, so anything it names
    // is vouched for. It must never vouch for a peer it is not actually connected to.
    const peers = new PeerGraph();
    await seedPeers(peers, ['pk-anna']);
    const agent = await makeAgent({ peers });
    registerReachablePeersSkill(agent, { peerScope: () => ['pk-anna', 'pk-fabricated'] });

    expect((await askAs(agent, 'pk-bram')).body.p).toEqual(['pk-anna']);
    await agent.stop();
  });

  it('a scoper returning junk discloses nothing rather than throwing', async () => {
    const peers = new PeerGraph();
    await seedPeers(peers, ALL);
    for (const bad of [null, undefined, 'pk-anna', 42, {}]) {
      const agent = await makeAgent({ peers });
      registerReachablePeersSkill(agent, { peerScope: () => bad });
      expect((await askAs(agent, 'pk-bram')).body.p, `scope returned ${JSON.stringify(bad)}`).toEqual([]);
      await agent.stop();
    }
  });

  it('the open scope still works — a mesh demo says so out loud', async () => {
    const peers = new PeerGraph();
    await seedPeers(peers, ALL);
    const agent = await makeAgent({ peers });
    registerReachablePeersSkill(agent, { peerScope: (_caller, all) => all });
    expect((await askAs(agent, 'pk-anyone')).body.p).toEqual(ALL);
    await agent.stop();
  });
});
