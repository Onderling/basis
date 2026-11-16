/**
 * On a central-pod circle a member's device reaches the circle's root on the founder's pod. It must not write the
 * circle's key resource there on its own: not restore its vault's copy over the pod's (a stale copy would undo a
 * rotation), and not mint a first key (a rival to the founder's). It reads what the founder wrote.
 */
import { describe, it, expect } from 'vitest';
import { produceWithPair } from './support/deviceSealingKeyPair.js';
import { generateKeypair } from '@onderling/pod-client';

class MemVault { #m = new Map(); async get(k) { return this.#m.get(k); } async set(k, v) { this.#m.set(k, String(v)); } async delete(k) { this.#m.delete(k); } }
function spyPod() {
  const m = new Map(); const writes = [];
  return {
    writes, m,
    client: {
      read: async (uri) => { if (!m.has(uri)) { const e = new Error('nf'); e.code = 'NOT_FOUND'; throw e; } return { content: m.get(uri) }; },
      write: async (uri, body) => { writes.push(uri); m.set(uri, typeof body === 'string' ? body : JSON.stringify(body)); },
      list: async () => [],
    },
  };
}
const ROOT = 'https://ann.pod/circles/c1';

describe('a producer that does not own the circle root', () => {
  it('writes no key resource at boot — neither a restored copy nor a fresh key', async () => {
    const vault = new MemVault();
    await vault.set('cc.circle-groupkey:c1', JSON.stringify({ version: 1, stale: true }));
    const pod = spyPod();
    await produceWithPair({ circleId: 'c1', storagePosture: 'p2', vault, generateKeypair, makePodClient: () => pod.client, circleRootUri: ROOT, ownsRoot: false });
    expect(pod.writes.filter((u) => u.includes('/.keys/'))).toEqual([]);
  });

  it('the owner still restores and bootstraps as before', async () => {
    const pod = spyPod();
    await produceWithPair({ circleId: 'c1', storagePosture: 'p2', vault: new MemVault(), generateKeypair, makePodClient: () => pod.client, circleRootUri: ROOT });
    expect(pod.writes.some((u) => u === `${ROOT}/.keys/group.json`)).toBe(true);
  });
});
