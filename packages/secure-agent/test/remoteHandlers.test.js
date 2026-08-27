/**
 * remoteHandlers.test.js — B #63 Tier-2 remote-handler dispatch tier.
 *
 * Proves the external-agent tier end-to-end over a shared InternalBus:
 *   register (live) → grant (ocap) → remote-dispatch via A2A → revoke → DENY.
 *
 * Two in-process `core.Agent`s on one bus stand in for the caller and the
 * remote/external agent (the InternalTransport/A2A seam — real network
 * transport is deferred, see the report). Everything reuses the kernel:
 * agent.invoke === callSkill, PolicyEngine, CapabilityToken, TokenRegistry.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory }          from '@onderling/vault';
import {
  Agent, AgentIdentity,
  InternalBus, InternalTransport,
  TrustRegistry, PolicyEngine, CapabilityToken, TokenRegistry,
  TextPart, Parts,
} from '@onderling/core';
import {
  RemoteHandlerRegistry,
  dispatchRemoteOp,
  grantRemoteCapability,
  NOT_REMOTE,
} from '../src/index.js';

/**
 * Build a caller (Alice) + a remote/external agent (Bob) on one bus.
 *
 * Bob exposes a `requires-token` skill and has a PolicyEngine + TrustRegistry.
 * Alice holds a TokenRegistry (so callSkill can attach a grant) and a
 * RemoteHandlerRegistry (the live op → remote-handler map).
 */
async function makeTier({ skillId = 'remote.compute' } = {}) {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);

  // Bob's trust view + revocation list.
  const trB    = new TrustRegistry(new VaultMemory());
  const bobRevocations = new TokenRegistry(new VaultMemory());  // doubles as revocation list

  // Alice holds grants here so callSkill attaches them.
  const aliceTokens = new TokenRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA, tokenRegistry: aliceTokens });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: trB });

  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  // Bob's external skill — the Tier-2 handler. requires-token → grant is the gate.
  bob.register(skillId, async (ctx) => {
    const input = Parts.text(ctx.parts) || '';
    return [TextPart(`remote:${input}`)];
  }, { visibility: 'authenticated', policy: 'requires-token' });

  // Install Bob's PolicyEngine AFTER the skill is registered so it references
  // the populated skill registry. Issuer-side revocation is CONSTRUCTED in — there is no setter,
  // so Bob's list is named where the gate is built and nothing can replace it later.
  const pe = new PolicyEngine({
    trustRegistry: trB,
    skillRegistry: bob.skills,
    agentPubKey:   bob.pubKey,
    isRevoked:     (id) => bobRevocations.isRevoked(id),
  });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });

  // Trust: Alice is authenticated (passes visibility); Bob (the issuer) is
  // trusted in his own registry so his self-issued grant is accepted.
  await trB.setTier(alice.pubKey, 'authenticated');
  await trB.setTier(bob.pubKey,   'trusted');

  const registry = new RemoteHandlerRegistry();

  return { bus, alice, bob, idA, idB, skillId, registry, aliceTokens, bobRevocations, pe };
}

describe('RemoteHandlerRegistry — live registration', () => {
  it('registers / resolves / lists / unregisters op → remote binding at runtime', () => {
    const reg = new RemoteHandlerRegistry();
    expect(reg.size).toBe(0);
    expect(reg.get('op.x')).toBeNull();

    reg.register('op.x', { remoteAddress: 'BOBKEY', skillId: 'remote.x' });
    expect(reg.has('op.x')).toBe(true);
    expect(reg.get('op.x')).toEqual({
      remoteAddress: 'BOBKEY', skillId: 'remote.x', capabilityRequired: true,
    });
    expect(reg.list()).toEqual(['op.x']);

    // Live re-point to a different agent (last-write-wins).
    reg.register('op.x', { remoteAddress: 'CAROLKEY' });
    expect(reg.get('op.x').remoteAddress).toBe('CAROLKEY');
    expect(reg.get('op.x').skillId).toBe('op.x');   // defaults to opId

    expect(reg.unregister('op.x')).toBe(true);
    expect(reg.has('op.x')).toBe(false);
    expect(reg.size).toBe(0);
  });

  it('rejects bad registrations', () => {
    const reg = new RemoteHandlerRegistry();
    expect(() => reg.register('', { remoteAddress: 'x' })).toThrow();
    expect(() => reg.register('op', {})).toThrow(/remoteAddress/);
  });
});

describe('dispatchRemoteOp — local path unchanged (additive)', () => {
  it('returns NOT_REMOTE for an unregistered op so caller falls through to local', async () => {
    const { alice, registry, bob } = await makeTier();
    const out = await dispatchRemoteOp(alice, registry, 'op.not-bound', []);
    expect(out).toBe(NOT_REMOTE);
    await alice.stop(); await bob.stop();
  });
});

describe('Tier-2 remote dispatch — grant IS the gate', () => {
  it('register → grant → dispatch routes to the remote agent and returns its result', async () => {
    const { alice, bob, skillId, registry } = await makeTier();

    // Live: bind an op to Bob's external skill.
    registry.register('op.compute', { remoteAddress: bob.address, skillId });

    // Grant: Bob signs an ocap for Alice; stored in Alice's TokenRegistry.
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    const out = await dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]);
    expect(Parts.text(out)).toBe('remote:hi');

    await alice.stop(); await bob.stop();
  });

  it('DENIES when no grant is held (requires-token, empty TokenRegistry)', async () => {
    const { alice, bob, skillId, registry } = await makeTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });
    // No grantRemoteCapability → no token attached.
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });

  it('DENIES a wrong-scope grant (token for a different skill)', async () => {
    const { alice, bob, registry } = await makeTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId: 'remote.compute' });
    // Grant covers a DIFFERENT skill → TokenRegistry.get won't match remote.compute.
    await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId: 'remote.other', expiresIn: 60_000,
    });
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('hi')]))
      .rejects.toThrow();
    await alice.stop(); await bob.stop();
  });

  it('DENIES an invalid grant — a token signed by an untrusted issuer (not Bob)', async () => {
    const { alice, bob, skillId, registry, aliceTokens } = await makeTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });

    // A well-formed token, correctly self-signed, but by a random identity that
    // is NOT trusted in Bob's TrustRegistry. PolicyEngine rejects it as
    // INVALID_TOKEN (issuer not trusted) — a forged/unauthorised grant.
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

describe('Tier-2 revocation — revoke → deny end-to-end', () => {
  it('issuer-side: revoking the grant makes the SAME dispatch deny (PolicyEngine rejects revoked)', async () => {
    const { alice, bob, skillId, registry, bobRevocations } = await makeTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });

    const token = await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000,
    });

    // 1) Works with the live grant.
    const ok = await dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('a')]);
    expect(Parts.text(ok)).toBe('remote:a');

    // 2) Bob revokes the grant into the revocation list PolicyEngine consults.
    await bobRevocations.revoke(token.id);

    // 3) The SAME dispatch now DENIES — PolicyEngine: INVALID_TOKEN: revoked.
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('b')]))
      .rejects.toThrow();

    await alice.stop(); await bob.stop();
  });

  it('holder-side: TokenRegistry.revoke makes callSkill attach no token → deny', async () => {
    const { alice, bob, skillId, registry, aliceTokens } = await makeTier();
    registry.register('op.compute', { remoteAddress: bob.address, skillId });

    const token = await grantRemoteCapability({
      hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000,
    });
    const ok = await dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('a')]);
    expect(Parts.text(ok)).toBe('remote:a');

    // Alice revokes her own held grant → TokenRegistry.get skips it → NO_TOKEN.
    await aliceTokens.revoke(token.id);
    await expect(dispatchRemoteOp(alice, registry, 'op.compute', [TextPart('b')]))
      .rejects.toThrow();

    await alice.stop(); await bob.stop();
  });
});
