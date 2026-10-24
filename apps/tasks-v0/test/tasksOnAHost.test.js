/**
 * The tasks engine on a HOST agent (as basis composes it: one agent per person). The host's engine judges every call
 * with the tasks side's revocations and its record of what it issued; nothing builds a second engine or registry.
 *   - a bot's key reaches only its token's `bot.*` scope: token-less, a tasks op is beyond its tier; with its token,
 *     a bot op answers; after the binding is revoked, the same token is refused;
 *   - a token is admitted only while on record: a grant issued in a circle that is not loaded is refused, and admitted
 *     once that circle loads.
 */
import { describe, it, expect } from 'vitest';
import { Agent, AgentIdentity, InternalBus, InternalTransport, PolicyEngine, TrustRegistry, anyRevoked } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createBrowserMultiCircleTasksAgent } from '../src/browser.js';

const ANNE = 'https://id.example/anne';
const deny = async (p) => { try { await p; return null; } catch (e) { return `${e.code ?? ''} ${e.message ?? e}`; } };

/** A host agent composed the way basis composes it, carrying the tasks engine. */
async function hostWithTasks({ identity, grantsVault }) {
  const bus = new InternalBus();
  const host = new Agent({ identity, transport: new InternalTransport(bus, identity.pubKey) });
  let tasks = null;
  const trustRegistry = new TrustRegistry(new VaultMemory());
  host.policyEngine = new PolicyEngine({
    trustRegistry, skillRegistry: host.skills, agentPubKey: identity.pubKey,
    isRevoked: anyRevoked([async (id) => Boolean(await tasks?.isRevoked(id))]),
    isAllowed: async (token) => Boolean(tasks?.isOnRecord(token)),
  });
  await trustRegistry.setTier(identity.pubKey, 'private');
  await host.start();
  const engine = host.policyEngine;
  tasks = await createBrowserMultiCircleTasksAgent({
    bus, agent: host, identityVault: grantsVault,
    primaryCircleConfig: { circleId: 'c1', name: 'C1', kind: 'household', members: [{ webid: ANNE, role: 'admin' }] },
  });
  return { host, engine, tasks };
}

describe('the tasks engine carried by a host', () => {
  it('builds no engine of its own: the host\'s judges, the tasks agent IS the host', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { host, engine, tasks } = await hostWithTasks({ identity, grantsVault: new VaultMemory() });
    expect(tasks.agent).toBe(host);
    expect(host.policyEngine).toBe(engine);
    expect(tasks.address).toBe(identity.pubKey);
  });

  it('a bot key reaches only its token\'s scope, and its token dies with the binding', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const { host, engine, tasks } = await hostWithTasks({ identity, grantsVault: new VaultMemory() });
    const reg = tasks.primaryCircleState.botAgentRegistry;
    const b = await reg.issue({ chatId: 'chat-1', webid: ANNE, ttlDays: 1 });
    const token = await reg.get('chat-1').tokenRegistry.get(host.pubKey, 'bot.listOpen');
    expect(token).toBeTruthy();
    expect(await deny(engine.checkInbound({ peerPubKey: b.botPubKey, skillId: 'listOpen' }))).toMatch(/INSUFFICIENT_TIER/);
    expect(await deny(engine.checkInbound({ peerPubKey: b.botPubKey, skillId: 'bot.listOpen', token: token.toJSON() }))).toBeNull();
    await reg.revoke({ chatId: 'chat-1' });
    expect(await deny(engine.checkInbound({ peerPubKey: b.botPubKey, skillId: 'bot.listOpen', token: token.toJSON() }))).toMatch(/INVALID_TOKEN/);
  });

  it('a grant from a circle that is not loaded is refused, and admitted once it loads', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const grantsVault = new VaultMemory();
    const member = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    const first = await hostWithTasks({ identity, grantsVault });
    const c2 = await first.tasks.ensureCircle('c2');
    const token = await c2.taskGrantManager.attachGrant({ taskId: 't-1', memberPubKey: member, grant: { skill: 'listOpen', constraints: {} } });
    expect(await deny(first.engine.checkInbound({ peerPubKey: member, skillId: 'listOpen', token: token.toJSON() }))).toBeNull();

    // a restart: c2 is not loaded until something touches it
    const again = await hostWithTasks({ identity, grantsVault });
    expect(await deny(again.engine.checkInbound({ peerPubKey: member, skillId: 'listOpen', token: token.toJSON() }))).toMatch(/not active/);
    const c2again = await again.tasks.ensureCircle('c2');
    await c2again.taskGrantManager.whenReady();
    expect(await deny(again.engine.checkInbound({ peerPubKey: member, skillId: 'listOpen', token: token.toJSON() }))).toBeNull();
  });
});
