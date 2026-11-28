/**
 * A FOUNDER'S VAULT COPY THAT CANNOT BE READ IS NEVER WRITTEN OVER. On an empty pod (the in-memory pod after a reload)
 * a group-key copy that did not parse read as "no copy": a fresh key was minted and saved over the copy, and every row
 * sealed under the old key was lost. The key-holder notes and the members' pod WebIDs, read as empty, were written
 * back empty at the next save. Now: an unreadable key copy on an empty pod stops the producer the way an unreadable
 * controller key does (`key-unreadable`, nothing changed); unreadable notes are kept as they are and not saved over.
 */
import { describe, it, expect } from 'vitest';
import { PodClient, generateKeypair } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { VaultMemory } from '@onderling/vault';
import { createCirclePodProducer } from '../src/v2/circlePodProducer.js';

const CIRCLE = 'unreadable-copy';
const COPY = `basis.circle-groupkey:${CIRCLE}`;
const HOLDERS = `basis.circle-groupkey:key-holders:${CIRCLE}`;
const POD_AGENTS = `basis.circle-groupkey:pod-agents:${CIRCLE}`;
const freshPod = () => {
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'x' });
  return new PodClient({ podRoot: 'pseudo-pod://x/', auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
};
const start = (vault, pair, makePodClient = () => freshPod()) => createCirclePodProducer({
  circleId: CIRCLE, storagePosture: 'p2', vault, generateKeypair, sealingKeyPair: pair,
  makePodClient, circleRootUri: `pseudo-pod://x/circles/${CIRCLE}`,
});

describe('a founder\'s vault copy that cannot be read', () => {
  it('on an empty pod: the producer is not built, nothing minted, the copy left as it was', async () => {
    const pair = generateKeypair();
    const vault = new VaultMemory();
    await start(vault, pair);   // first start: the controller key and a copy exist
    expect(await vault.get(COPY)).toBeTruthy();
    await vault.set(COPY, '{"wrapped": [trunc');   // damaged, or a newer build's shape
    const err = await start(vault, pair).then(() => null, (e) => e);
    expect(err?.code).toBe('key-unreadable');
    expect(err?.what).toBe('group-key-copy');
    expect(await vault.get(COPY)).toBe('{"wrapped": [trunc');
  });

  it('the key-holder notes and the members\' pod WebIDs that cannot be read are not written back empty', async () => {
    const pair = generateKeypair();
    const vault = new VaultMemory();
    const p = await start(vault, pair);
    await p.keyHolders.note('KEY-A', 'ref:ann');
    await vault.set(HOLDERS, '{"KEY-A": "ref:a');
    await vault.set(POD_AGENTS, '{"ref:ann": "https://ann.pod/pro');
    const again = await start(vault, pair);
    expect(await again.keyHolders.note('KEY-B', 'ref:bob')).toBe(false);   // refused: the notes could not be read
    await again.persist();
    expect(await vault.get(HOLDERS)).toBe('{"KEY-A": "ref:a');
    expect(await vault.get(POD_AGENTS)).toBe('{"ref:ann": "https://ann.pod/pro');
  });
});
