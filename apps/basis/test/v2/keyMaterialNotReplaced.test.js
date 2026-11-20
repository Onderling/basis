/**
 * Key material is made only when NOTHING is stored; a value that is there but is not a key is never replaced
 * (ledger L1115; the stored-shapes audit, silent-loss place 2): a circle's controller key, the member sealing identity.
 */
import { describe, it, expect } from 'vitest';
import { PodClient, generateKeypair, createMemberSealingIdentity } from '@onderling/pod-client';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { VaultMemory } from '@onderling/vault';
import { createCirclePodProducer } from '../../src/v2/circlePodProducer.js';

/** A VaultMemory that counts writes. */
function countingVault() {
  const v = new VaultMemory();
  let writes = 0;
  const set = v.set.bind(v);
  v.set = async (k, val) => { writes += 1; return set(k, val); };
  return { v, writes: () => writes };
}

describe('a circle\'s controller key (L1115)', () => {
  const start = (vault) => {
    const pod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' });
    return createCirclePodProducer({
      circleId: 'c1', storagePosture: 'p2', vault, generateKeypair, sealingKeyPair: generateKeypair(),
      makePodClient: () => new PodClient({ podRoot: 'pseudo-pod://d/', auth: { getAuthHeaders: async () => ({}) }, pseudoPod: pod }),
      circleRootUri: 'pseudo-pod://d/circles/c1',
    });
  };

  it('nothing stored: one is made and kept', async () => {
    const { v } = countingVault();
    await start(v);
    const keys = (await v.list?.()) ?? [];
    const stored = await v.get(keys.find((k) => /c1$/.test(k)) ?? '');
    expect(JSON.parse(stored)).toMatchObject({ publicKey: expect.any(String), privateKey: expect.any(String) });
  });

  it('a stored value that is not a keypair is not replaced: the producer is not built, nothing written', async () => {
    const { v, writes } = countingVault();
    await start(v);
    const key = ((await v.list?.()) ?? []).find((k) => /c1$/.test(k));
    await v.set(key, '{"publicKey":"only-half"');   // a damaged value
    const before = await v.get(key);
    const n = writes();
    const err = await start(v).then(() => null, (e) => e);
    expect(err?.code).toBe('key-unreadable');
    expect(await v.get(key)).toBe(before);
    expect(writes()).toBe(n);
  });
});

describe('the member sealing identity (L1115)', () => {
  it('nothing stored: made once; a damaged one is not replaced', async () => {
    const m = new Map();
    const store = { get: async (k) => m.get(k) ?? null, set: async (k, val) => { m.set(k, val); } };
    const id = createMemberSealingIdentity({ store });
    const first = await id.ensure();
    expect(await id.ensure()).toEqual(first);
    m.set('cc.sealing-identity', 'not json');
    await expect(id.ensure()).rejects.toMatchObject({ code: 'key-unreadable' });
    expect(m.get('cc.sealing-identity')).toBe('not json');
  });
});
