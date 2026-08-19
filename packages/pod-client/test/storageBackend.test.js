/**
 * StorageBackend port — pod-client conformance + the "seal is the gate" proof.
 *
 * The port (`@onderling/core` StorageBackend) is a BLIND ciphertext store. This suite proves:
 *   1. the reference in-memory adapter (`MemoryStorageBackend`) satisfies the port;
 *   2. the pod adapter (`podStorageBackend`) round-trips ciphertext over a PodClient-shaped client
 *      and holds no plaintext;
 *   3. STORAGE-SWAP / seal-is-the-gate — content sealed ABOVE the port via the seal resolver
 *      (`sealForAudience`) opens after being put/get through backend A, and opens JUST THE SAME after
 *      the identical sealed bytes are moved to a DIFFERENT backend instance: the seal, not the store,
 *      gates access, so the store is a free choice and the content is portable;
 *   4. a wrong-key open fails (a non-key-holder reads nothing, whatever the store).
 *
 * A two-agent, real-roster version of (3)/(4) lives in apps/basis/test/appStorageBackend.test.js
 * (via pairRealAgents' sealed-circle harness). Here the group key is generated directly so the proof
 * is pure and runs in milliseconds.
 */
import { describe, it, expect } from 'vitest';
import {
  assertStorageBackendConformance,
} from '@onderling/core/conformance';
import { MemoryStorageBackend } from '@onderling/core';
import {
  podStorageBackend,
  generateGroupKey,
  sealForAudience,
  openSealedEnvelope,
} from '../src/index.js';

/** A minimal in-memory PodClient-shaped client: read/write/list over a Map, `{content}`-shaped reads. */
function fakePodClient() {
  const store = new Map();
  return {
    async write(uri, content) { store.set(uri, content); },
    async read(uri) {
      if (!store.has(uri)) { const e = new Error('not found'); e.code = 'NOT_FOUND'; throw e; }
      return { content: store.get(uri) };
    },
    async list(prefix = '') {
      return [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((uri) => ({ uri }));
    },
    _raw: store,
  };
}

describe('StorageBackend port — MemoryStorageBackend (reference adapter)', () => {
  it('satisfies the StorageBackend port', async () => {
    await assertStorageBackendConformance(() => new MemoryStorageBackend(), { label: 'MemoryStorageBackend' });
  });
});

describe('StorageBackend port — podStorageBackend (Solid pod adapter)', () => {
  it('satisfies the port over a PodClient-shaped client', async () => {
    // requireInstance stays on: podStorageBackend returns a StorageBackend subclass.
    await assertStorageBackendConformance(() => podStorageBackend(fakePodClient()), { label: 'podStorageBackend' });
  });

  it('get() of an absent ref is null (NOT_FOUND → null, not a throw)', async () => {
    const backend = podStorageBackend(fakePodClient());
    expect(await backend.get('circle/x/missing')).toBe(null);
  });

  it('round-trips opaque ciphertext byte-for-byte and stores no plaintext', async () => {
    const pod = fakePodClient();
    const backend = podStorageBackend(pod);
    const groupKey = generateGroupKey();
    const plaintext = 'ledenvergadering donderdag 20:00';
    const env = sealForAudience(plaintext, { groupKey }, { audience: 'circle' });
    const ref = 'circle/circle/msg/1';

    await backend.put(ref, JSON.stringify(env));
    // What the pod actually holds is the sealed envelope string — never the plaintext.
    const stored = pod._raw.get(ref);
    expect(stored).not.toContain(plaintext);
    expect(stored).toContain('group-key');       // the scheme tag survives; the body is ciphertext
    // get() hands the exact stored bytes back; open ABOVE the port recovers the plaintext.
    const got = await backend.get(ref);
    expect(got).toBe(JSON.stringify(env));
    expect(openSealedEnvelope(JSON.parse(got), { groupKey })).toBe(plaintext);
  });
});

describe('StorageBackend port — storage-swap / seal is the gate', () => {
  it('sealed content put through backend A opens; moved to backend B it still opens', async () => {
    const groupKey = generateGroupKey();
    const plaintext = 'de sleutel is de poort, niet de opslag';
    const env = sealForAudience(plaintext, { groupKey }, { audience: 'circle' });
    const wire = JSON.stringify(env);
    const ref = 'circle/circle/msg/42';

    // Two DIFFERENT, independent backends of different kinds (in-memory + pod-backed).
    const backendA = new MemoryStorageBackend();
    const backendB = podStorageBackend(fakePodClient());

    // Put into A, read back, open — the round-trip through a store the seal gated.
    await backendA.put(ref, wire);
    const fromA = await backendA.get(ref);
    expect(openSealedEnvelope(JSON.parse(fromA), { groupKey })).toBe(plaintext);

    // Move the SAME sealed bytes to a DIFFERENT backend — no re-seal, no key hand-off — and it STILL opens.
    await backendB.put(ref, fromA);
    const fromB = await backendB.get(ref);
    expect(fromB).toBe(wire);                                                   // portable byte-for-byte
    expect(openSealedEnvelope(JSON.parse(fromB), { groupKey })).toBe(plaintext); // and still opens

    // Neither store ever held plaintext.
    expect(fromA).not.toContain(plaintext);
    expect(fromB).not.toContain(plaintext);
  });

  it('a wrong-key open fails, whatever the store', async () => {
    const groupKey = generateGroupKey();
    const wrongKey = generateGroupKey();
    const env = sealForAudience('geheim', { groupKey }, { audience: 'circle' });

    const backend = new MemoryStorageBackend();
    await backend.put('circle/circle/msg/9', JSON.stringify(env));
    const got = await backend.get('circle/circle/msg/9');

    // The right key opens; the wrong key throws (the secretbox auth tag rejects it) — the store is
    // irrelevant to who can read. A wrong-key holder gets nothing from a perfectly readable store.
    expect(openSealedEnvelope(JSON.parse(got), { groupKey })).toBe('geheim');
    expect(() => openSealedEnvelope(JSON.parse(got), { groupKey: wrongKey })).toThrow();
  });
});
