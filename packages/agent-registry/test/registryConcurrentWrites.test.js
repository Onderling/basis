/**
 * TWO WRITES AT ONCE ON ONE DEVICE KEEP BOTH. The registry is one resource holding every entry; each mutation reads it,
 * changes one entry and writes the whole body back. The pseudo-pod does not compare-and-swap, so two mutations in
 * flight at once each read the body WITHOUT the other's entry, and the later write drops the earlier one. Found in a
 * real browser: a persona created while the boot was still writing the general row lost its registry record (its
 * disclosure, its circles), while it kept running.
 */
import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';

const entry = (id) => ({ agentId: id, pubKey: `pub-${id}`, webid: 'https://anne.pod/profile#me', agentUri: `https://anne.pod/profile#me/agent/${id}`, role: 'device', name: id });

function slowPod() {
  // a backend whose writes take a moment, as IndexedDB's do — enough for two mutations to interleave
  const mem = createMemoryBackend();
  const backend = { ...mem, put: async (...a) => { await new Promise((r) => setTimeout(r, 5)); return mem.put(...a); } };
  return createPseudoPod({ backend, mode: 'standalone', deviceId: 'laptop-anne' });
}

describe('concurrent registry writes on one device', () => {
  it('two registers at once: both entries survive', async () => {
    const reg = createAgentRegistry({ pseudoPod: slowPod(), deviceId: 'laptop-anne' });
    await Promise.all([reg.register(entry('default')), reg.register(entry('p-werk'))]);
    expect(await reg.lookup('default'), 'the first write').toBeTruthy();
    expect(await reg.lookup('p-werk'), 'the second write').toBeTruthy();
  });

  it('two handles over the SAME pseudo-pod (the shell may build more than one): still both', async () => {
    const pod = slowPod();
    const a = createAgentRegistry({ pseudoPod: pod, deviceId: 'laptop-anne' });
    const b = createAgentRegistry({ pseudoPod: pod, deviceId: 'laptop-anne' });
    await Promise.all([a.register(entry('default')), b.register(entry('p-werk')), a.register(entry('p-buurt'))]);
    for (const id of ['default', 'p-werk', 'p-buurt']) expect(await a.lookup(id), id).toBeTruthy();
  });
});
