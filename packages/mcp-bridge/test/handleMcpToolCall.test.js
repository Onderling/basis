/**
 * handleMcpToolCall.test.js — INBOUND direction: prove the gate holds across
 * the MCP seam.
 *
 * Reuses the #63 grant/revoke harness (two in-process core.Agents on one
 * InternalBus, `agent.invoke` === callSkill, PolicyEngine + CapabilityToken +
 * TokenRegistry). Bob exposes a `requires-token` skill with an EXECUTION
 * COUNTER so we can assert a denied call never runs the skill.
 *
 * Proves: authorized → runs + MCP result; ungranted / revoked / unknown →
 * MCP isError with the skill NOT executed.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory }          from '@onderling/vault';
import {
  Agent, AgentIdentity,
  InternalBus, InternalTransport,
  TrustRegistry, PolicyEngine, TokenRegistry,
  TextPart, DataPart, Parts,
} from '@onderling/core';
import {
  RemoteHandlerRegistry,
  grantRemoteCapability,
} from '@onderling/secure-agent';
import { handleMcpToolCall } from '../src/index.js';

/**
 * Caller (Alice) + host (Bob) on one bus. Bob's `remote.compute` skill reads
 * the MCP arguments via Parts.data and increments `calls.n` each time it runs.
 */
async function makeTier({ skillId = 'remote.compute' } = {}) {
  const bus = new InternalBus();
  const idA = await AgentIdentity.generate(new VaultMemory());
  const idB = await AgentIdentity.generate(new VaultMemory());
  const tA  = new InternalTransport(bus, idA.pubKey);
  const tB  = new InternalTransport(bus, idB.pubKey);

  const trB            = new TrustRegistry(new VaultMemory());
  const bobRevocations = new TokenRegistry(new VaultMemory());
  const aliceTokens    = new TokenRegistry(new VaultMemory());

  const alice = new Agent({ identity: idA, transport: tA, tokenRegistry: aliceTokens });
  const bob   = new Agent({ identity: idB, transport: tB, trustRegistry: trB });

  alice.addPeer(bob.address, bob.pubKey);
  bob.addPeer(alice.address, alice.pubKey);
  await alice.start(); await bob.start();

  const calls = { n: 0 };
  bob.register(skillId, async (ctx) => {
    calls.n++;                                    // ← proves the skill actually executed
    const args = Parts.data(ctx.parts) || {};
    return [TextPart(`ran:${args.text ?? ''}`), DataPart({ ok: true, echo: args })];
  }, { visibility: 'authenticated', policy: 'requires-token' });

  // Issuer-side revocation is CONSTRUCTED into the engine — there is no setter, so Bob's list is
  // named where the gate is built and nothing can replace it later.
  const pe = new PolicyEngine({
    trustRegistry: trB, skillRegistry: bob.skills, agentPubKey: bob.pubKey,
    isRevoked: (id) => bobRevocations.isRevoked(id),
  });
  Object.defineProperty(bob, 'policyEngine', { get: () => pe, configurable: true });

  await trB.setTier(alice.pubKey, 'authenticated');
  await trB.setTier(bob.pubKey,   'trusted');

  const registry = new RemoteHandlerRegistry();
  registry.register('op.compute', { remoteAddress: bob.address, skillId });

  return { alice, bob, skillId, registry, aliceTokens, bobRevocations, calls };
}

describe('handleMcpToolCall — authorized call runs through the gate', () => {
  it('grant held → dispatches through callSkill, returns an MCP result (not isError)', async () => {
    const { alice, bob, skillId, registry, calls } = await makeTier();
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    const res = await handleMcpToolCall(
      alice,
      { name: 'op.compute', arguments: { text: 'hi' } },
      { registry },
    );

    expect(res.isError).toBeUndefined();
    expect(res.content[0]).toEqual({ type: 'text', text: 'ran:hi' });
    expect(res.structuredContent).toMatchObject({ ok: true, echo: { text: 'hi' } });
    expect(calls.n).toBe(1);                       // skill actually executed once

    await alice.stop(); await bob.stop();
  });
});

describe('handleMcpToolCall — the gate holds (deny → MCP error, skill NOT executed)', () => {
  it('UNGRANTED capability → isError, skill never runs', async () => {
    const { alice, bob, registry, calls } = await makeTier();
    // No grant issued.
    const res = await handleMcpToolCall(alice, { name: 'op.compute', arguments: { text: 'x' } }, { registry });

    expect(res.isError).toBe(true);
    expect(res._meta.code).toBe('denied_or_failed');
    expect(calls.n).toBe(0);                       // gate rejected BEFORE the handler ran

    await alice.stop(); await bob.stop();
  });

  it('REVOKED capability → the same call that worked now returns isError, no further execution', async () => {
    const { alice, bob, skillId, registry, bobRevocations, calls } = await makeTier();
    const token = await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId, expiresIn: 60_000 });

    // 1) Works.
    const ok = await handleMcpToolCall(alice, { name: 'op.compute', arguments: { text: 'a' } }, { registry });
    expect(ok.isError).toBeUndefined();
    expect(calls.n).toBe(1);

    // 2) Revoke.
    await bobRevocations.revoke(token.id);

    // 3) Same call now denies; skill count unchanged.
    const denied = await handleMcpToolCall(alice, { name: 'op.compute', arguments: { text: 'b' } }, { registry });
    expect(denied.isError).toBe(true);
    expect(calls.n).toBe(1);                       // NOT executed again

    await alice.stop(); await bob.stop();
  });

  it('UNKNOWN tool (not bound) → isError, nothing dispatched', async () => {
    const { alice, bob, registry, calls } = await makeTier();
    await grantRemoteCapability({ hostAgent: bob, callerAgent: alice, skillId: 'remote.compute', expiresIn: 60_000 });

    const res = await handleMcpToolCall(alice, { name: 'op.does-not-exist', arguments: {} }, { registry });
    expect(res.isError).toBe(true);
    expect(res._meta.code).toBe('unknown_tool');
    expect(calls.n).toBe(0);

    await alice.stop(); await bob.stop();
  });

  it('UNKNOWN tool via manifest guard → isError before any dispatch', async () => {
    const { alice, bob, registry } = await makeTier();
    const manifest = { operations: [{ id: 'op.compute' }] };
    const res = await handleMcpToolCall(alice, { name: 'op.compute', arguments: {} }, { registry, manifest });
    // op.compute IS in the manifest but ungranted → denied (proves guard let it through to the gate).
    expect(res.isError).toBe(true);

    const res2 = await handleMcpToolCall(alice, { name: 'op.rogue', arguments: {} }, { registry, manifest });
    expect(res2._meta.code).toBe('unknown_tool');

    await alice.stop(); await bob.stop();
  });

  it('malformed tool-call (no name) → isError, no dispatch', async () => {
    const { alice, bob, registry, calls } = await makeTier();
    const res = await handleMcpToolCall(alice, { arguments: {} }, { registry });
    expect(res.isError).toBe(true);
    expect(res._meta.code).toBe('invalid_request');
    expect(calls.n).toBe(0);
    await alice.stop(); await bob.stop();
  });
});
