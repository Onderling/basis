/**
 * A7 (substrate-adoption) — agent-registry registration on Stoop
 * bundle bring-up.
 *
 * Verifies:
 *   - attachSubstrateMirror registers this bundle's agent in the
 *     agent-registry by default (under `pseudo-pod://<deviceId>/private/agent-registry`).
 *   - Registration is idempotent (re-attaching for a second group
 *     upserts the same agentId entry).
 *   - `agentRegistry: false` opts out.
 *   - Soft-fail on transient errors — bundle still wires up.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent }    from '../src/index.js';
import { attachSubstrateMirror }      from '../src/substrateMirror.js';

const ANNE  = 'https://id.example/anne';
const GROUP = 'oosterpoort';

async function makeBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  return createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: GROUP, localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
}

describe('A7 — agent-registry registration on bundle bring-up', () => {
  it('registers the agent in the registry by default', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    expect(bundle.agentRegistry).toBeTruthy();
    const agents = await bundle.agentRegistry.list();
    expect(agents).toHaveLength(1);
    expect(agents[0].pubKey).toBe(bundle.agent.identity.pubKey);
    expect(agents[0].agentId).toBe(bundle.agent.identity.pubKey);
    expect(agents[0].agentUri).toBe(`agent://${bundle.agent.identity.pubKey}`);
    expect(agents[0].role).toBe('device');
    expect(agents[0].deviceId).toBe(bundle.agent.identity.deviceId);
    expect(agents[0].capabilities).toEqual(['stoop']);
  });

  it('lookups resolve by pubKey, deviceId, and agentUri', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const pubKey   = bundle.agent.identity.pubKey;
    const deviceId = bundle.agent.identity.deviceId;
    expect((await bundle.agentRegistry.lookup(pubKey))?.pubKey).toBe(pubKey);
    expect((await bundle.agentRegistry.lookup(deviceId))?.pubKey).toBe(pubKey);
    expect((await bundle.agentRegistry.lookup(`agent://${pubKey}`))?.pubKey).toBe(pubKey);
    expect(await bundle.agentRegistry.lookup('unknown')).toBe(null);
  });

  it('honours custom opts (capabilities + name)', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, {
      group: GROUP,
      agentRegistry: {
        capabilities: ['stoop', 'browser', 'web-push'],
        name:         'Anne (laptop)',
      },
    });
    const agents = await bundle.agentRegistry.list();
    expect(agents[0].capabilities).toEqual(['stoop', 'browser', 'web-push']);
    expect(agents[0].name).toBe('Anne (laptop)');
  });

  it('skips registration when agentRegistry === false', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP, agentRegistry: false });
    expect(bundle.agentRegistry).toBeUndefined();
  });

  it('soft-fail: bundle.agentRegistry is null when register() rejects but mirror still wires', async () => {
    const bundle = await makeBundle();
    // Force a register() rejection: `agentUri: ''` violates createAgentRegistry's
    // non-empty-string check (`packages/agent-registry/src/AgentRegistry.js`).
    await attachSubstrateMirror(bundle, {
      group:         GROUP,
      agentRegistry: { agentUri: '' },
    });
    expect(bundle.mirror).toBeTruthy();
    expect(bundle.agentRegistry).toBeNull();
  });

  it('re-attaching (different group) upserts the same agent entry', async () => {
    const bundle = await makeBundle();
    await attachSubstrateMirror(bundle, { group: GROUP });
    const beforeAgents = await bundle.agentRegistry.list();
    expect(beforeAgents).toHaveLength(1);
    // Second attach simulates the multi-bundle-per-agent case
    // (apps/stoop/bin/stoop-testbed.js style). Each call mutates the
    // bundle.agentRegistry; the underlying pseudoPod resource keeps a
    // single entry keyed on agentId (= pubKey).
    await attachSubstrateMirror(bundle, { group: 'other-group' });
    const afterAgents = await bundle.agentRegistry.list();
    expect(afterAgents).toHaveLength(1);
    expect(afterAgents[0].pubKey).toBe(beforeAgents[0].pubKey);
  });
});
