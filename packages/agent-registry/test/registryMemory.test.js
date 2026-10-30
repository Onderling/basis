/**
 * The registry holds what it read. Every lookup (a profile's properties, its disclosure, the list of agents) read the
 * whole registry resource from the backend and normalised it again — and on a phone that backend SEALS at rest, so each
 * lookup unsealed the whole blob in JS (the Mij landing: getProfileProperties 3.2 s, two JS blocks of 1.3 s and 3.8 s,
 * 2026-10-30). The registry now keeps the normalised body while the pseudo-pod's revision of its resource has not moved;
 * any write through the pseudo-pod (its own, a pull from the pod, a peer's) moves it, and the next read loads again.
 */
import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';

const ENTRY = (id, name) => ({ agentId: id, pubKey: `pub-${id}`, webid: `https://x.pod/profile#me`, agentUri: `https://x.pod/agent/${id}`, role: 'profile', name, deviceId: id });

function counted() {
  const backend = createMemoryBackend();
  const gets = { n: 0 };
  const get = backend.get.bind(backend);
  backend.get = async (...a) => { gets.n += 1; return get(...a); };
  return { backend, gets };
}

describe('the registry holds what it read', () => {
  it('two lookups read the backend once; a write through the pseudo-pod makes the next read load again', async () => {
    const { backend, gets } = counted();
    const pseudoPod = createPseudoPod({ backend, mode: 'standalone', deviceId: 'dev-1' });
    const reg = createAgentRegistry({ pseudoPod, deviceId: 'dev-1' });
    await reg.register(ENTRY('a', 'Anna'));
    gets.n = 0;
    expect((await reg.lookup('a'))?.name).toBe('Anna');
    expect((await reg.lookup('a'))?.name).toBe('Anna');
    expect(gets.n, 'two lookups after its own write read nothing: the write is what it holds').toBe(0);

    // another writer through the same pseudo-pod (a pull from the pod, a peer's write) changes the resource
    const uri = reg.resourceUri ?? (await pseudoPod.list?.(''))?.[0];
    const cur = await pseudoPod.read(reg.resourceUri);
    const body = typeof cur.bytes === 'string' ? JSON.parse(cur.bytes) : cur.bytes;
    body.agents = body.agents.map((x) => (x.agentId === 'a' ? { ...x, name: 'Anna B' } : x));
    await pseudoPod.write(reg.resourceUri, body);
    gets.n = 0;
    expect((await reg.lookup('a'))?.name, 'the change is seen').toBe('Anna B');
    expect(gets.n).toBe(1);
    expect(uri).toBeTruthy();
  });

  it('its own write is seen at once, and held without another read', async () => {
    const { backend, gets: COUNT } = counted();
    const pseudoPod = createPseudoPod({ backend, mode: 'standalone', deviceId: 'dev-1' });
    const reg = createAgentRegistry({ pseudoPod, deviceId: 'dev-1' });
    await reg.register(ENTRY('a', 'Anna'));
    await reg.lookup('a');
    const { gets } = { gets: COUNT };
    gets.n = 0;
    await reg.register(ENTRY('b', 'Bram'));
    const afterWrite = gets.n;
    expect((await reg.lookup('b'))?.name).toBe('Bram');
    expect(gets.n, 'the lookup after its own write reads nothing more').toBe(afterWrite);
    expect((await reg.list?.() ?? []).map((x) => x.agentId).sort()).toEqual(['a', 'b']);
  });
});
