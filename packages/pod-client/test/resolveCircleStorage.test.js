import { describe, it, expect, vi } from 'vitest';
import { resolveCircleStorage, circleStorageClient } from '../src/sealing/resolveCircleStorage.js';
import { generateKeypair, generateGroupKey, isSealed } from '../src/sealing/index.js';

function fakePod() {
  const store = new Map();
  return {
    store,
    async write(uri, content) { store.set(uri, content); return { ok: true }; },
    async read(uri) {
      if (!store.has(uri)) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
      return { uri, content: store.get(uri) };
    },
  };
}

describe('resolveCircleStorage — posture → strategy', () => {
  it('p0 (plaintext) and p1 (enclave) → no client-side strategy', () => {
    expect(resolveCircleStorage({ posture: 'p0', groupKey: generateGroupKey() })).toBeNull();
    expect(resolveCircleStorage({ posture: 'p1', groupKey: generateGroupKey() })).toBeNull();
    expect(resolveCircleStorage({})).toBeNull();                 // missing/unknown → plaintext
  });

  it('p2 → a group-key strategy that round-trips', () => {
    const gk = generateGroupKey();
    const s = resolveCircleStorage({ posture: 'p2', groupKey: gk });
    expect(s).toBeTruthy();
    expect(s.open(s.seal('household note'))).toBe('household note');
  });

  it('p2 without a group key → null (fail-safe, never seals with missing material)', () => {
    expect(resolveCircleStorage({ posture: 'p2' })).toBeNull();
  });

  it('p3 → a recipient strategy (writer seals with pubkeys, processor opens with the private key)', () => {
    const k = generateKeypair();
    const writer = resolveCircleStorage({ posture: 'p3', recipients: k.publicKey });
    const env = writer.seal('contribution');
    const processor = resolveCircleStorage({ posture: 'p3', privateKey: k.privateKey });
    expect(processor.open(env)).toBe('contribution');
  });

  it('p3 with neither recipients nor a private key → null', () => {
    expect(resolveCircleStorage({ posture: 'p3' })).toBeNull();
  });
});

describe('circleStorageClient — wrap or pass through', () => {
  it('p0 returns the plain client unchanged (same ref)', () => {
    const pod = fakePod();
    expect(circleStorageClient(pod, { posture: 'p0' })).toBe(pod);
  });

  it('p2 returns a SealedPodClient: the host holds ciphertext, members read plaintext', async () => {
    const pod = fakePod();
    const gk = generateGroupKey();
    const client = circleStorageClient(pod, { posture: 'p2', groupKey: gk });
    expect(client).not.toBe(pod);
    await client.write('/list', 'milk, bread');
    expect(isSealed(pod.store.get('/list'))).toBe(true);
    expect(pod.store.get('/list')).not.toContain('milk');
    expect((await client.read('/list')).content).toBe('milk, bread');
  });
});
