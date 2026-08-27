/**
 * remoteHandlersNetwork.test.js — B #63 Tier-2 remote-handler tier, carried
 * over a genuine NETWORK boundary (the #63 network tail).
 *
 * This is the sibling of remoteHandlers.test.js. That suite proved the tier
 * over a shared `InternalBus` (same-process A2A). Here the caller (Alice) and
 * the remote/host agent (Bob) share NO bus: their ONLY link is a
 * `NetworkTransport` (@onderling/transports) over a MOCK in-memory loopback
 * channel — Bob's `receiveFrame` fed from Alice's injected `send` and back.
 * Real HTTP/WebSocket/DPoP + a listening server are DEFERRED; nothing here
 * opens a real socket.
 *
 * Because the two agents are on separate NetworkTransports (not Internal
 * transports on one bus), callSkill's in-process fast-path does NOT apply: the
 * call takes the full WIRE path — SecurityLayer encrypt → frame → channel →
 * decode → decrypt → handleTaskRequest → runGatedSkill (the gate) → respond.
 *
 * Proven across the boundary, reusing the exact #63 tier + kernel gate:
 *   - grant → dispatch → the remote skill actually runs, result returns;
 *   - a remote skill ERROR propagates as an error on the caller;
 *   - the capability gate HOLDS: ungranted / wrong-scope / forged / revoked
 *     (issuer- and holder-side) all DENY over the network exactly as in-process.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import {
  Agent, AgentIdentity,
  TrustRegistry, PolicyEngine, CapabilityToken, TokenRegistry,
  TextPart, Parts,
} from '@onderling/core';
import { createNetworkTransport } from '@onderling/transports';
import {
  RemoteHandlerRegistry,
  dispatchRemoteOp,
  grantRemoteCapability,
} from '../src/index.js';

/**
 * A mock in-memory loopback "network": a directory of address → transport whose
 * `receiveFrame` we call. Each transport's injected `send(frame)` decodes just
 * enough to find the recipient and delivers asynchronously (a microtask hop —
 * models real network async without a socket). The two transports share NOTHING
 * but this router; there is no InternalBus.
 */
function makeLoopbackNet() {
  const inboxes = new Map();   // address → NetworkTransport
  const deliver = (frame) => {
    const { to } = JSON.parse(frame);
    const peer = inboxes.get(to);
    if (!peer) return;                       // unknown peer → dropped (as a real net would)
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
 * Build Alice (caller) + Bob (remote host) linked ONLY by the network transport.
 * Mirrors makeTier() in remoteHandlers.test.js, swapping the shared InternalBus
 * for the loopback network.
 */
async function makeNetworkTier({ skillId = 'remote.compute' } = {}) {
  const net = makeLoopbackNet();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = net.transportFor(idA);
  const tB  = net.transportFor(idB);

  const trB             = new TrustRegistry(new VaultMemory());
  const bobRevocations  = new TokenRegistry(new VaultMemory());
  const aliceTokens     = new TokenRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA, tokenRegistry: aliceTokens });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: trB });

  // Register peer keys both ways so SecurityLayer can encrypt/decrypt across
  // the boundary (the network transport carries real ciphertext).
  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  bob.register(skillId, async (ctx) => {
    const input = Parts.text(ctx.parts) || '';
    if (input === '__boom__') throw new Error('remote skill exploded');
    return [TextPart(`remote:${input}`)];
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

  const registry = new RemoteHandlerRegistry();
  return { alice, bob, idA, idB, skillId, registry, aliceTokens, bobRevocations, pe, tA, tB };
}

describe('#63 over a NETWORK boundary — grant IS the gate, across the wire', () => {
  it('proves the two agents share no bus (only the network transport)', async () => {
    const { tA, tB, alice, bob } = await makeNetworkTier();
    // No InternalBus/InternalTransport anywhere → the fast-path cannot apply.
    expect(tA.constructor.name).toBe('NetworkTransport');
    expect(tB.constructor.name).toBe('NetworkTransport');
    expect(tA).not.toBe(tB);
    await alice.stop(); await bob.stop();
  });

  it('register → grant → dispatch routes over the wire and the remote skill runs', async () => {
    const { alice, bob, skillId, registry } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    const out = await dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]);
    expect(Parts.text(out)).toBe('remote:hi');   // Bob's skill actually ran; result came back
    await alice.stop(); await bob.stop();
  });

  it('propagates a remote skill ERROR as an error on the caller', async () => {
    const { alice, bob, skillId, registry } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('__boom__')]))
      .rejects.toThrow(/exploded/);
    await alice.stop(); await bob.stop();
  });

  it('DENIES when no grant is held (empty TokenRegistry) — gate holds across the wire', async () => {
    const { alice, bob, skillId, registry } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });

  it('DENIES a wrong-scope grant (token for a different skill)', async () => {
    const { alice, bob, registry } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId: 'remote.compute' });
    await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId: 'remote.other', expiresIn: 60_000,
    });
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });

  it('DENIES a forged grant (token signed by an untrusted issuer)', async () => {
    const { alice, bob, skillId, registry, aliceTokens } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });

    const mallory = await AgentIdentity.generate(new VaultMemory());
    const forged  = await CapabilityToken.issue(mallory, {
      subject: alice.address, agentId: bob.pubKey, skill: skillId, expiresIn: 60_000,
    });
    await aliceTokens.store(forged);

    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });
});

describe('#63 over a NETWORK boundary — revoke → deny end-to-end', () => {
  it('issuer-side: revoking makes the SAME wire dispatch deny', async () => {
    const { alice, bob, skillId, registry, bobRevocations } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });
    const token = await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000,
    });

    const ok = await dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('a')]);
    expect(Parts.text(ok)).toBe('remote:a');

    await bobRevocations.revoke(token.id);
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('b')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });

  it('holder-side: TokenRegistry.revoke → callSkill attaches no token → deny', async () => {
    const { alice, bob, skillId, registry, aliceTokens } = await makeNetworkTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });
    const token = await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000,
    });
    const ok = await dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('a')]);
    expect(Parts.text(ok)).toBe('remote:a');

    await aliceTokens.revoke(token.id);
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('b')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });
});
