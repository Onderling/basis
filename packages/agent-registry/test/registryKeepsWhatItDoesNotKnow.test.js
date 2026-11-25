/**
 * THE AGENT REGISTRY NEVER NARROWS OR OVERWRITES WHAT A NEWER BUILD WROTE.
 *
 * Every read ran each agent through a strict allowlist, and the next write persisted the narrowed rows: a field a newer
 * build added to an agent was dropped at the first write. And the resource's `v` was never compared, so a registry a
 * newer build wrote in a different format was taken as this one and written over. Now: an agent's fields this build
 * does not know are carried along as they were (the known ones are still checked and win), and a registry whose `v` is
 * newer than this build's — or that is not an object at all — refuses every write (lookups go on).
 */
import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { RESOURCE_VERSION } from '../src/resource.js';

const URI = 'pseudo-pod://d1/private/agent-registry';
const ANNE = { agentId: 'a1', pubKey: 'pub-a1', agentUri: 'u-a1', role: 'device', capabilities: [] };

async function podWith(body) {
  const pod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd1' });
  if (body !== undefined) await pod.write(URI, body);
  return pod;
}

describe('the agent registry keeps what it does not know', () => {
  it('an agent field a newer build added survives a write of another agent', async () => {
    const pod = await podWith({ v: RESOURCE_VERSION, agents: [{ ...ANNE, futureField: { x: 1 } }], updatedAt: 'x' });
    const reg = createAgentRegistry({ pseudoPod: pod, deviceId: 'd1' });
    await reg.register({ agentId: 'b2', pubKey: 'pub-b2', agentUri: 'u-b2', role: 'device', capabilities: [] });
    const stored = (await pod.read(URI)).bytes;
    expect(stored.agents.find((a) => a.agentId === 'a1').futureField).toEqual({ x: 1 });
  });

  it('a known field is still checked: a bad kind does not come back through the carried fields', async () => {
    const pod = await podWith({ v: RESOURCE_VERSION, agents: [{ ...ANNE, kind: 'root' }], updatedAt: 'x' });
    const reg = createAgentRegistry({ pseudoPod: pod, deviceId: 'd1' });
    expect((await reg.lookup('a1')).kind).toBeUndefined();
  });

  it('a registry written by a newer build refuses every write, and lookups still work', async () => {
    const newer = { v: RESOURCE_VERSION + 1, agents: [ANNE], updatedAt: 'x' };
    const pod = await podWith(newer);
    const reg = createAgentRegistry({ pseudoPod: pod, deviceId: 'd1' });
    expect((await reg.lookup('a1'))?.agentId).toBe('a1');
    await expect(reg.register({ agentId: 'b2', pubKey: 'pub-b2', agentUri: 'u-b2', role: 'device', capabilities: [] }))
      .rejects.toMatchObject({ code: 'REGISTRY_NOT_READABLE' });
    expect((await pod.read(URI)).bytes).toEqual(newer);
  });
});
