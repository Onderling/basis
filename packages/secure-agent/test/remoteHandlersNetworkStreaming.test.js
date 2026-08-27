/**
 * remoteHandlersNetworkStreaming.test.js — #63 remote-handler tier carried over
 * the NETWORK boundary for a STREAMING (multi-frame) skill.
 *
 * The sibling remoteHandlersNetwork.test.js proved the common request→result
 * case over the NetworkTransport. This suite closes the deferral the
 * NetworkTransport report flagged: one-way task OWs (streaming chunks) in a pure
 * fetch model would need a push back-channel — so it is proven here over the
 * SYMMETRIC bidirectional mock channel (both sides have send + receiveFrame),
 * NOT the one-way `handleNetworkRequest` fetch seam.
 *
 * The streaming primitive carried is the kernel's transport-agnostic
 * `callSkill` streaming path (NOT `sendA2AStreamTask`, which is the HTTP/SSE
 * fetch model): a generator skill on the host emits, for one request id, N
 * `stream-chunk` OW frames (fresh _id, no _re) + a terminal `task-result` RS
 * (_re = the RQ _id). The caller consumes them via `task.stream()`. These are
 * EXACTLY the frames the in-process InternalTransport carries — the
 * NetworkTransport is frame-agnostic and carries them unchanged.
 *
 * Proven across the boundary, reusing the exact #63 gate:
 *   - grant → the streaming skill runs, ALL chunks arrive IN ORDER, correlated
 *     to the task, and the stream terminates (task completed);
 *   - the gate HOLDS for streaming: an ungranted / revoked subscription is
 *     DENIED over the wire and NO chunk frames leak past the gate.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import {
  Agent, AgentIdentity,
  TrustRegistry, PolicyEngine, TokenRegistry,
  TextPart, Parts,
} from '@onderling/core';
import { createNetworkTransport } from '@onderling/transports';
import {
  grantRemoteCapability,
} from '../src/index.js';

/**
 * Mock in-memory loopback network (identical to remoteHandlersNetwork.test.js):
 * a directory of address → transport whose receiveFrame we call. Each
 * transport's injected send(frame) delivers asynchronously (a microtask hop).
 * The two transports share NOTHING but this router — no InternalBus. Because it
 * is BIDIRECTIONAL (each side's send reaches the peer's receiveFrame), the OW
 * stream-chunk frames flow back to the caller — the push channel a pure fetch
 * seam lacks.
 */
function makeLoopbackNet() {
  const inboxes = new Map();
  const deliver = (frame) => {
    const { to } = JSON.parse(frame);
    const peer = inboxes.get(to);
    if (!peer) return;
    queueMicrotask(() => peer.receiveFrame(frame));
  };
  return {
    transportFor(identity) {
      const t = createNetworkTransport({ identity, send: deliver });
      inboxes.set(identity.pubKey, t);
      return t;
    },
  };
}

/**
 * Build Alice (caller) + Bob (streaming host) linked ONLY by the network
 * transport. Mirrors makeNetworkTier() in remoteHandlersNetwork.test.js, but
 * registers a STREAMING (async-generator) skill gated with requires-token.
 */
async function makeStreamingNetworkTier({ skillId = 'remote.stream' } = {}) {
  const net = makeLoopbackNet();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = net.transportFor(idA);
  const tB  = net.transportFor(idB);

  const trB            = new TrustRegistry(new VaultMemory());
  const bobRevocations = new TokenRegistry(new VaultMemory());
  const aliceTokens    = new TokenRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA, tokenRegistry: aliceTokens });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: trB });

  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  // Streaming skill: yields N chunks (the count comes in the request parts),
  // then completes. Gated: authenticated visibility + requires-token.
  bob.register(skillId, async function* (ctx) {
    const n = parseInt(Parts.text(ctx.parts) ?? '3', 10);
    for (let i = 1; i <= n; i++) yield [TextPart(`chunk-${i}`)];
  }, { visibility: 'authenticated', policy: 'requires-token' });

  // Issuer-side revocation is CONSTRUCTED into the engine — there is no setter, so Bob's list is
  // named where the gate is built and nothing can replace it later.
  const pe = new PolicyEngine({
    trustRegistry: trB,
    skillRegistry: bob.skills,
    agentPubKey:   bob.pubKey,
    isRevoked:     (id) => bobRevocations.isRevoked(id),
  });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });

  await trB.setTier(alice.pubKey, 'authenticated');
  await trB.setTier(bob.pubKey,   'trusted');

  return { alice, bob, skillId, aliceTokens, bobRevocations, pe, tA, tB };
}

/** Consume a Task's stream to completion; returns { chunks, state, error }. */
async function drain(task) {
  const chunks = [];
  for await (const c of task.stream()) chunks.push(Parts.text(c));
  let state = task.state, error;
  try { const r = await task.done(); state = r.state; }
  catch (err) { state = 'failed'; error = err.message; }
  return { chunks, state, error };
}

describe('#63 streaming over a NETWORK boundary — chunks flow, gate holds', () => {
  it('two agents share no bus; both endpoints are NetworkTransports', async () => {
    const { tA, tB, alice, bob } = await makeStreamingNetworkTier();
    expect(tA.constructor.name).toBe('NetworkTransport');
    expect(tB.constructor.name).toBe('NetworkTransport');
    expect(tA).not.toBe(tB);
    await alice.stop(); await bob.stop();
  });

  it('grant → streaming skill runs; ALL chunks arrive IN ORDER + stream terminates', async () => {
    const { alice, bob, skillId } = await makeStreamingNetworkTier();
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    const task = alice.call(bob.address, skillId, [TextPart('5')]);
    const { chunks, state } = await drain(task);

    expect(chunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3', 'chunk-4', 'chunk-5']);
    expect(state).toBe('completed');
    await alice.stop(); await bob.stop();
  });

  it('DENIES an ungranted streaming subscription — NO chunk frames leak past the gate', async () => {
    const { alice, bob, skillId } = await makeStreamingNetworkTier();
    // No grant issued: alice holds no capability token for the streaming skill.
    const task = alice.call(bob.address, skillId, [TextPart('5')]);
    const { chunks, state } = await drain(task);

    expect(chunks).toEqual([]);        // gate ran BEFORE the generator; no chunk leaked
    expect(state).toBe('failed');      // denied over the wire
    await alice.stop(); await bob.stop();
  });

  it('issuer revoke → the SAME streaming subscription now denies, no chunks leak', async () => {
    const { alice, bob, skillId, bobRevocations } = await makeStreamingNetworkTier();
    const token = await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000,
    });

    // First subscription streams fine.
    const ok = await drain(alice.call(bob.address, skillId, [TextPart('3')]));
    expect(ok.chunks).toEqual(['chunk-1', 'chunk-2', 'chunk-3']);
    expect(ok.state).toBe('completed');

    // Revoke → the same wire subscription denies with no chunk leakage.
    await bobRevocations.revoke(token.id);
    const denied = await drain(alice.call(bob.address, skillId, [TextPart('3')]));
    expect(denied.chunks).toEqual([]);
    expect(denied.state).toBe('failed');
    await alice.stop(); await bob.stop();
  });

  it('holder revoke → callSkill attaches no token → deny, no chunks leak', async () => {
    const { alice, bob, skillId, aliceTokens } = await makeStreamingNetworkTier();
    const token = await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000,
    });
    const ok = await drain(alice.call(bob.address, skillId, [TextPart('2')]));
    expect(ok.chunks).toEqual(['chunk-1', 'chunk-2']);

    await aliceTokens.revoke(token.id);
    const denied = await drain(alice.call(bob.address, skillId, [TextPart('2')]));
    expect(denied.chunks).toEqual([]);
    expect(denied.state).toBe('failed');
    await alice.stop(); await bob.stop();
  });
});
