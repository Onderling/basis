// appStorageBackend.test.js — app-level proof that storage is a free choice because the SEAL, not the
// store, gates access (the StorageBackend port).
//
//   • storage-swap / seal is the gate — a REAL sealed circle's content (sealed once by the seal resolver,
//     fanned over the real transport) is persisted through a StorageBackend, retrieved and opened by a
//     member; the IDENTICAL sealed bytes moved to a DIFFERENT StorageBackend instance (a different KIND of
//     backend) still open for that member — no re-seal, no key hand-off. The store is swappable because the
//     seal is the gate.
//   • a non-member opens nothing, whatever the store holds.
//   • no backend ever holds plaintext.
//
// Runs over the real `pairRealAgents` node harness (real app agents, real circle join + sealed-circle key
// establishment, in-process transport — no browser / relay / network). The pure, generated-key version of
// this proof lives in packages/pod-client/test/storageBackend.test.js.
import { describe, it, expect, afterAll } from 'vitest';
import { MemoryStorageBackend } from '@onderling/core';
import { podStorageBackend } from '@onderling/pod-client';
import {
  bootRealAgentNode, connectNodesOverBus, createCircle, joinExistingCircle,
  bootSealedCircle, postSealed, readSealed, until, teardown,
} from './support/pairRealAgents.js';

/** A minimal in-memory PodClient-shaped client so `podStorageBackend` has a real (different-KIND) target. */
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
  };
}

describe('StorageBackend — storage-swap / the seal is the gate (real sealed circle)', () => {
  let A, B, D;
  afterAll(async () => { await teardown(A, B, D); });

  it('sealed circle content persists through one backend, opens; the same bytes on a DIFFERENT backend still open; a non-member never opens', async () => {
    const GID = 'storage-swap-circle';
    [A, B, D] = await Promise.all([
      bootRealAgentNode('A'), bootRealAgentNode('B'), bootRealAgentNode('D'),
    ]);
    await connectNodesOverBus([A, B, D]);

    // A REAL circle: A creates, B joins. D is booted but NEVER joins — the non-member.
    await createCircle(A, { groupId: GID, name: 'Storage Swap Circle' });
    await joinExistingCircle(A, B, { groupId: GID, handle: 'bee' });

    // Seal the circle (v1 group key sealed to A + B's sealing keys, fanned as a key-event).
    await bootSealedCircle({ admin: A, members: [B], groupId: GID });
    await until(() => B.keyEvents.length >= 1);

    // A seals content ONCE via the seal resolver and fans it; B records the sealed envelope.
    const plaintext = 'circle meeting donderdag 20:00';
    const env = await postSealed({ admin: A, members: [B], groupId: GID, text: plaintext });
    await until(() => B.sealedContent.length >= 1);

    // The sealed envelope is what goes to the store — serialise it to opaque wire bytes.
    const wire = JSON.stringify(env);
    const ref = `${GID}/msg/1`;

    // Backend A: an in-memory StorageBackend. Backend B: a pod-backed one — a DIFFERENT KIND of store.
    const backendMem = new MemoryStorageBackend();
    const backendPod = podStorageBackend(fakePodClient());

    // Persist through the in-memory backend, retrieve, and open as B (its real key chain, via readSealed).
    await backendMem.put(ref, wire);
    const fromMem = await backendMem.get(ref);
    expect(readSealed(B, JSON.parse(fromMem), GID)).toBe(plaintext);

    // STORAGE-SWAP: move the SAME sealed bytes to the pod-backed backend — no re-seal — and B still opens.
    await backendPod.put(ref, fromMem);
    const fromPod = await backendPod.get(ref);
    expect(fromPod).toBe(wire);                                  // portable byte-for-byte across stores
    expect(readSealed(B, JSON.parse(fromPod), GID)).toBe(plaintext);

    // The SEAL is the gate: D (a non-member, holds no key for this circle) opens nothing — from EITHER store.
    expect(() => readSealed(D, JSON.parse(fromMem), GID)).toThrow();
    expect(() => readSealed(D, JSON.parse(fromPod), GID)).toThrow();

    // No backend ever held plaintext — only the sealed envelope.
    expect(fromMem).not.toContain(plaintext);
    expect(fromPod).not.toContain(plaintext);
  });
});
