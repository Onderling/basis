/**
 * The registry says when it changed — whatever wrote it: its own writes (a sibling's profile facts land through them),
 * the carrier's pull of a newer copy from the pod, a write beneath it through the pseudo-pod. A screen that shows those
 * facts (Mij) listens; they are no circle's items, so no circle hook tells it.
 */
import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';

const ENTRY = (id, name) => ({ agentId: id, pubKey: `pub-${id}`, webid: `https://x.pod/profile#me`, agentUri: `https://x.pod/agent/${id}`, role: 'profile', name, deviceId: id });

describe('the registry says when it changed', () => {
  it('onChanged fires after each of its own writes, and unsubscribes', async () => {
    const reg = createAgentRegistry({ pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'dev-1' }), deviceId: 'dev-1' });
    const heard = [];
    const off = reg.onChanged(() => heard.push('x'));
    await reg.register(ENTRY('a', 'Anna'));
    await reg.revoke('a');
    expect(heard).toHaveLength(2);
    off();
    await reg.register(ENTRY('b', 'Bram'));
    expect(heard).toHaveLength(2);
  });

  it('a write beneath it (the carrier pulling a newer copy from the pod) is heard too', async () => {
    const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'dev-1' });
    const reg = createAgentRegistry({ pseudoPod, deviceId: 'dev-1' });
    await reg.register(ENTRY('a', 'Anna'));
    const heard = [];
    reg.onChanged(() => heard.push('x'));
    const cur = await pseudoPod.read(reg.resourceUri);
    const body = typeof cur.bytes === 'string' ? JSON.parse(cur.bytes) : cur.bytes;
    body.agents = body.agents.map((x) => (x.agentId === 'a' ? { ...x, name: 'Anna B' } : x));
    await pseudoPod.write(reg.resourceUri, body);   // what registryCarrier.attach does with a newer pod copy
    expect(heard.length, 'the pull is heard').toBeGreaterThanOrEqual(1);
  });

  it('two pseudo-pods over one backend hear each other (two registries in one process)', async () => {
    const backend = createMemoryBackend();
    const podA = createPseudoPod({ backend, mode: 'standalone', deviceId: 'dev-1' });
    const podB = createPseudoPod({ backend, mode: 'standalone', deviceId: 'dev-1' });
    const regA = createAgentRegistry({ pseudoPod: podA, deviceId: 'dev-1' });
    const regB = createAgentRegistry({ pseudoPod: podB, deviceId: 'dev-1' });
    const heard = [];
    regA.onChanged(() => heard.push('a'));
    await regB.register(ENTRY('b', 'Bram'));
    expect(heard.length, 'A hears B').toBeGreaterThanOrEqual(1);
  });
});
