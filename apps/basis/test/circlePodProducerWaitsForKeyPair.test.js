/**
 * A SEALED circle's producer is built only with the device's own per-circle sealing key pair. Asked for before the
 * agent is up (no key pair yet), there is no producer and no stand-in key; the circle waits, and the bind builds it.
 * The stand-in (a random per-circle key kept in the vault) opened the circle's key with a key nobody had wrapped to.
 */
import { describe, it, expect } from 'vitest';
import { PodClient, generateKeypair } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { VaultMemory } from '@onderling/vault';
import { createCirclePodProducer, createProducerKeyWait } from '../src/v2/circlePodProducer.js';

function makePodClient(circleId) {
  const deviceId = `circle-${circleId}`;
  const pseudoPod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
  return new PodClient({ podRoot: `pseudo-pod://${deviceId}/`, auth: { getAuthHeaders: async () => ({}) }, pseudoPod });
}

describe('a sealed circle producer waits for the device key pair', () => {
  it('without a key pair there is no producer: it refuses, and stores no stand-in key in the vault', async () => {
    const vault = new VaultMemory();
    await expect(createCirclePodProducer({ circleId: 'w1', storagePosture: 'p2', vault, generateKeypair, makePodClient }))
      .rejects.toMatchObject({ code: 'NO_SEALING_KEY_PAIR' });
    expect(await vault.get('cc.circle-sealing-id:w1') ?? null, 'no random identity kept').toBeNull();
  });

  it('with the key pair it opens with exactly that key', async () => {
    const pair = generateKeypair();
    const prod = await createCirclePodProducer({ circleId: 'w2', storagePosture: 'p2', vault: new VaultMemory(), generateKeypair, makePodClient, sealingKeyPair: pair });
    expect((await prod.sealingIdentity.ensure()).publicKey).toBe(pair.publicKey);
    expect(await prod.controlAgent.sealingStrategy(pair.privateKey)).toBeTruthy();
  });

  it('a plaintext circle needs no key pair', async () => {
    const prod = await createCirclePodProducer({ circleId: 'w3', storagePosture: 'p0', vault: new VaultMemory() });
    expect(prod.controlAgent).toBeNull();
  });

  it('the wait list: noted circles are built once on the drain, with the policy they were asked with', async () => {
    const wait = createProducerKeyWait();
    wait.note('a', { storagePosture: 'p2' }); wait.note('b', { storagePosture: 'p3' }); wait.note('a', { storagePosture: 'p2' });
    expect(wait.size()).toBe(2);
    const built = [];
    expect(await wait.drain(async (id, policy) => { built.push([id, policy.storagePosture]); return { id }; })).toBe(2);
    expect(built).toEqual([['a', 'p2'], ['b', 'p3']]);
    expect(wait.size()).toBe(0);
    expect(await wait.drain(async () => ({}))).toBe(0);
  });
});
