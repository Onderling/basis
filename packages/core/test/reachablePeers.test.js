/**
 * reachable-peers skill + agent.enableReachabilityOracle()
 * See CODING-PLAN.md Group T3.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent }                 from '../src/Agent.js';
import { AgentIdentity }         from '../src/identity/AgentIdentity.js';
import { VaultMemory }           from '@onderling/vault';
import { InternalBus, InternalTransport } from '../src/transport/InternalTransport.js';
import { PeerGraph }             from '../src/discovery/PeerGraph.js';
import { AgentConfig }           from '../src/config/AgentConfig.js';
import { Parts }                  from '../src/Parts.js';
import { verifyReachabilityClaim } from '../src/security/reachabilityClaim.js';
import {
  registerReachablePeersSkill,
  DEFAULT_TTL_MS,
  DEFAULT_REFRESH_BEFORE_MS,
  DEFAULT_MAX_PEERS,
}                                 from '../src/skills/reachablePeers.js';

/**
 * The open scope, stated explicitly. Every case below is about CLAIM MECHANICS (ttl / seq / caching), not
 * about disclosure — so they opt into "every caller learns every peer", which since 2026-07-27 (G7) a
 * caller must say out loud rather than get by omission. Disclosure itself is covered in
 * `reachablePeersScope.test.js`.
 */
const OPEN = (_caller, peers) => peers;


// ── Helpers ───────────────────────────────────────────────────────────────────

async function makeAgent({ peers = new PeerGraph(), config } = {}) {
  const bus      = new InternalBus();
  const identity = await AgentIdentity.generate(new VaultMemory());
  const agent    = new Agent({
    identity,
    transport: new InternalTransport(bus, identity.pubKey),
    peers,
    config,
  });
  await agent.start();
  return agent;
}

/** Seed a PeerGraph with N direct peers (hops:0, reachable:true). */
async function seedDirectPeers(graph, count, prefix = 'pk') {
  const pks = [];
  for (let i = 0; i < count; i++) {
    // Pad so lexicographic sort lines up with insertion order.
    const pk = `${prefix}${String(i).padStart(3, '0')}`;
    pks.push(pk);
    await graph.upsert({ pubKey: pk, hops: 0, reachable: true });
  }
  return pks;
}

async function invokeSelf(agent) {
  // Call the skill through the public Agent API — InternalTransport loops back.
  return agent.invoke(agent.address, 'reachable-peers', []);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reachable-peers skill — basic behaviour', () => {

  it('returns a claim verifiable by the issuer pubKey', async () => {
    const peers = new PeerGraph();
    await seedDirectPeers(peers, 3);
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000 });

    const parts = await invokeSelf(agent);
    const data  = Parts.data(parts);
    expect(data.body).toBeTruthy();
    expect(data.sig).toBeTruthy();

    const res = verifyReachabilityClaim(data, { expectedIssuer: agent.pubKey });
    expect(res.ok).toBe(true);
    expect(data.body.p).toEqual(['pk000', 'pk001', 'pk002']);

    await agent.stop();
  });

  it('excludes self from the published list', async () => {
    const peers = new PeerGraph();
    const agent = await makeAgent({ peers });

    // Put self in the graph (unusual — simulating a malformed state).
    await peers.upsert({ pubKey: agent.pubKey, hops: 0, reachable: true });
    await peers.upsert({ pubKey: 'pkOther', hops: 0, reachable: true });

    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000 });
    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.p).toEqual(['pkOther']);  // self filtered out
    await agent.stop();
  });

  it('excludes indirect (hops > 0) peers', async () => {
    const peers = new PeerGraph();
    await peers.upsert({ pubKey: 'direct',   hops: 0, reachable: true });
    await peers.upsert({ pubKey: 'indirect', hops: 1, reachable: true });
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000 });

    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.p).toEqual(['direct']);
    await agent.stop();
  });

  it('excludes unreachable peers', async () => {
    const peers = new PeerGraph();
    await peers.upsert({ pubKey: 'on',  hops: 0, reachable: true  });
    await peers.upsert({ pubKey: 'off', hops: 0, reachable: false });
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000 });

    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.p).toEqual(['on']);
    await agent.stop();
  });
});

describe('reachable-peers skill — caching', () => {

  it('returns byte-equal bodies on repeated calls within the refresh window', async () => {
    const peers = new PeerGraph();
    await seedDirectPeers(peers, 2);
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000, refreshBeforeMs: 10_000 });

    const a = Parts.data(await invokeSelf(agent));
    const b = Parts.data(await invokeSelf(agent));
    expect(a.body).toEqual(b.body);
    expect(a.sig).toBe(b.sig);
    await agent.stop();
  });

  it('produces a new claim (higher s, updated p) after a direct peer joins', async () => {
    const peers = new PeerGraph();
    await seedDirectPeers(peers, 2);
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000, refreshBeforeMs: 10_000 });

    const first = Parts.data(await invokeSelf(agent));
    expect(first.body.p).toEqual(['pk000', 'pk001']);

    // Add a third direct peer.
    await peers.upsert({ pubKey: 'pk999', hops: 0, reachable: true });

    const second = Parts.data(await invokeSelf(agent));
    expect(second.body.p).toEqual(['pk000', 'pk001', 'pk999']);
    expect(second.body.s).toBeGreaterThan(first.body.s);
    await agent.stop();
  });

  it('removes a peer from the next claim when they go unreachable', async () => {
    const peers = new PeerGraph();
    await seedDirectPeers(peers, 2);
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000, refreshBeforeMs: 10_000 });

    const first = Parts.data(await invokeSelf(agent));
    expect(first.body.p).toEqual(['pk000', 'pk001']);

    await peers.setReachable('pk001', false);

    const second = Parts.data(await invokeSelf(agent));
    expect(second.body.p).toEqual(['pk000']);
    await agent.stop();
  });

  it('re-signs when remaining TTL drops below refreshBeforeMs', async () => {
    const peers = new PeerGraph();
    await seedDirectPeers(peers, 1);
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000, refreshBeforeMs: 40_000 });

    const realNow = Date.now;
    const t0      = realNow();
    Date.now      = () => t0;
    try {
      const a = Parts.data(await invokeSelf(agent));
      const s1 = a.body.s;

      // Fast-forward 10 s — still within "ttlMs - refreshBeforeMs" = 20 s window
      Date.now = () => t0 + 10_000;
      const b = Parts.data(await invokeSelf(agent));
      expect(b.body.s).toBe(s1);   // still cached

      // Fast-forward 25 s — crosses into the "must refresh" window
      Date.now = () => t0 + 25_000;
      const c = Parts.data(await invokeSelf(agent));
      expect(c.body.s).toBeGreaterThan(s1);
    } finally {
      Date.now = realNow;
    }
    await agent.stop();
  });
});

describe('reachable-peers skill — maxPeers truncation', () => {

  it('truncates to maxPeers in lexicographic order', async () => {
    const peers = new PeerGraph();
    await seedDirectPeers(peers, 10);   // pk000..pk009
    const agent = await makeAgent({ peers });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 60_000, maxPeers: 5 });

    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.p).toEqual(['pk000', 'pk001', 'pk002', 'pk003', 'pk004']);
    await agent.stop();
  });
});

describe('reachable-peers skill — config resolution', () => {

  it('reads defaults from AgentConfig when no explicit args are given', async () => {
    const peers  = new PeerGraph();
    await seedDirectPeers(peers, 6);
    const config = new AgentConfig({
      overrides: { oracle: { ttlMs: 30_000, refreshBeforeMs: 5_000, maxPeers: 3 } },
    });
    const agent = await makeAgent({ peers, config });
    // `peerScope` is deliberately NOT config-resolvable — it is a function, so it can only be passed at the
    // call site, which is the right place for a disclosure decision to be visible. The numeric options are
    // what this case is about, and they still come from AgentConfig.
    agent.enableReachabilityOracle({ peerScope: OPEN });

    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.t).toBe(30_000);
    expect(data.body.p).toHaveLength(3);
    await agent.stop();
  });

  it('explicit arguments override AgentConfig', async () => {
    const peers  = new PeerGraph();
    await seedDirectPeers(peers, 6);
    const config = new AgentConfig({
      overrides: { oracle: { ttlMs: 30_000, maxPeers: 3 } },
    });
    const agent = await makeAgent({ peers, config });
    agent.enableReachabilityOracle({ peerScope: OPEN, ttlMs: 99_000, maxPeers: 2 });

    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.t).toBe(99_000);
    expect(data.body.p).toHaveLength(2);
    await agent.stop();
  });

  it('falls through to the built-in defaults when neither is set', async () => {
    const agent = await makeAgent();
    agent.enableReachabilityOracle();
    const data = Parts.data(await invokeSelf(agent));
    expect(data.body.t).toBe(DEFAULT_TTL_MS);
    await agent.stop();
  });
});

describe('enableReachabilityOracle — idempotent', () => {

  it('second call does not re-register the skill', async () => {
    const agent = await makeAgent();
    agent.enableReachabilityOracle();
    const first = agent.skills.get('reachable-peers');

    agent.enableReachabilityOracle();
    const second = agent.skills.get('reachable-peers');

    expect(second).toBe(first);
    await agent.stop();
  });

  it('returns the agent for chaining', async () => {
    const agent = await makeAgent();
    expect(agent.enableReachabilityOracle()).toBe(agent);
    await agent.stop();
  });
});
