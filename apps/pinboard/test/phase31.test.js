/**
 * Pinboard — Phase 31: core.Agent.swapIdentity replaces the running keypair without a restart and emits
 * 'self-swapped'. (The phrase restore that once called it is gone: the recovery phrase restores the owner root, in
 * the host, never this agent.)
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart, generateMnemonic } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildBundle(vault) {
  const id = vault
    ? await AgentIdentity.generate(vault)
    : await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return { bundle, id };
}

describe('Pinboard V2.5 Phase 31.1 — Agent.swapIdentity (core)', () => {
  it('replaces the running keypair + emits self-swapped', async () => {
    const { bundle } = await buildBundle();
    const oldPubKey = bundle.agent.pubKey;
    const phrase = generateMnemonic();

    // Build a fresh AgentIdentity from a different vault/seed.
    const otherVault = new VaultMemory();
    const newId = await AgentIdentity.fromMnemonic(phrase, otherVault);
    expect(newId.pubKey).not.toBe(oldPubKey);

    const events = [];
    bundle.agent.on('self-swapped', (e) => events.push(e));

    const r = bundle.agent.swapIdentity(newId);
    expect(r.oldPubKey).toBe(oldPubKey);
    expect(r.newPubKey).toBe(newId.pubKey);
    expect(bundle.agent.pubKey).toBe(newId.pubKey);
    expect(bundle.agent.identity.stableId).toBe(newId.stableId);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ oldPubKey, newPubKey: newId.pubKey });
  });

  it('same-pubKey swap is a no-op (no event emitted)', async () => {
    const { bundle } = await buildBundle();
    const events = [];
    bundle.agent.on('self-swapped', (e) => events.push(e));
    bundle.agent.swapIdentity(bundle.agent.identity);
    expect(events).toHaveLength(0);
  });

  it('rejects bad inputs', async () => {
    const { bundle } = await buildBundle();
    expect(() => bundle.agent.swapIdentity(null)).toThrow();
    expect(() => bundle.agent.swapIdentity({})).toThrow();
  });
});

