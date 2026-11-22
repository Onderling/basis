/**
 * A START THAT CHANGES NOTHING WRITES NOTHING (the upgrade walk, 2026-11-20: every start wrote the same keys again).
 * Measured on the box (three starts of the real device runner on one data folder): starts 2 and 3 rewrote the agent
 * registry and the peer and host trust marks with the same content. Each sealed write is a seal on the start's busiest
 * seconds. The registry's own card registered again with nothing changed, and a trust mark set to the tier it already
 * has, now write nothing.
 */
import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { TrustRegistry } from '@onderling/core';
import { createAgentRegistry } from '../src/AgentRegistry.js';

function countingPod() {
  const pod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'box' });
  let writes = 0;
  const write = pod.write.bind(pod);
  pod.write = (...a) => { writes += 1; return write(...a); };
  return { pod, writes: () => writes };
}
const CARD = { agentId: 'pk1', pubKey: 'pk1', agentUri: 'agent://pk1', role: 'device', deviceId: 'box', capabilities: ['tasks'] };

describe('the agent registry: the same card registered again writes nothing', () => {
  it('a second start registering the same card does not write', async () => {
    const { pod, writes } = countingPod();
    const reg = createAgentRegistry({ pseudoPod: pod, deviceId: 'box' });
    await reg.register(CARD);
    const after1 = writes();
    await reg.register(CARD);
    expect(writes() - after1).toBe(0);
  });

  it('a changed card still writes', async () => {
    const { pod, writes } = countingPod();
    const reg = createAgentRegistry({ pseudoPod: pod, deviceId: 'box' });
    await reg.register(CARD);
    const after1 = writes();
    await reg.register({ ...CARD, capabilities: ['tasks', 'chat'] });
    expect(writes() - after1).toBe(1);
    expect((await reg.lookup('pk1')).capabilities).toEqual(['tasks', 'chat']);
  });
});

describe('a trust mark set to what it already is writes nothing', () => {
  function countingVault() {
    const m = new Map(); let writes = 0;
    return {
      get: async (k) => (m.has(k) ? m.get(k) : null),
      set: async (k, v) => { writes += 1; m.set(k, v); },
      list: async () => [...m.keys()],
      writes: () => writes,
    };
  }
  it('setTier, addGroup and addTokenGrant with nothing new', async () => {
    const v = countingVault();
    const t = new TrustRegistry(v);
    await t.setTier('peer', 'trusted'); await t.addGroup('peer', 'g1'); await t.addTokenGrant('peer', 'tok1');
    const before = v.writes();
    await t.setTier('peer', 'trusted'); await t.addGroup('peer', 'g1'); await t.addTokenGrant('peer', 'tok1');
    await t.removeGroup('peer', 'not-there');
    expect(v.writes() - before).toBe(0);
    await t.setTier('peer', 'owner');
    expect(v.writes() - before).toBe(1);
  });
});
