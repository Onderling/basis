// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * A VALUE THE PHONE COULD NOT OPEN STAYS REFUSED WHEN THE CIRCLE'S STORE IS REBUILT. The sealing layer remembers "could
 * not open: do not write over" per storage NAME when one is given, else per backend object. The phone rebuilds a
 * circle's store (a new AsyncStorage backend object over the same scope) when a posture change drops the circle's
 * producer; without the name, the rebuilt store forgot the refusal and its first write replaced what it could not open.
 * This goes through `circlePods` (the phone's own composition), not the web path.
 *
 * Red first (without the name): the CACHE case only. The circle's own store keeps a history of displaced bytes, so its
 * write reads the row first and finds it unopenable itself; that case is kept as a pin of the whole path, not as proof.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { groupKeyStrategy } from '@onderling/pod-client';
import { initCirclePods, ensureCirclePod, provisionCircleMedium } from '../src/core/circlePods.js';
import { makeCirclePolicyStoreRN } from '../src/core/circleStoresRN.js';
import { createCirclePolicyStore } from '../../basis/src/v2/circlePolicyStore.js';
import { createSealingBackend } from '@onderling/pseudo-pod';
import { createAsBackend } from '@onderling/react-native/pseudo-pod-adapter';
import { bindCircleKeyPairs } from './support/circleKeyPairs.js';
import { useTestContentSeal } from './support/contentSeal.js';

useTestContentSeal();

function mockAsyncStorage() {
  const m = new Map();
  return {
    raw: m,
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
  };
}
const memIo = () => { const m = new Map(); return { load: async (id) => m.get(id) ?? null, save: async (id, v) => { m.set(id, v); } }; };

describe("the phone's circle store, rebuilt", () => {
  beforeEach(() => bindCircleKeyPairs());

  it('still refuses to write over a value it could not open', async () => {
    const storage = mockAsyncStorage();
    initCirclePods(storage);
    const policy = createCirclePolicyStore(memIo());
    const circleId = 'c-rebuild-refusal';
    await policy.update(circleId, { storagePosture: 'p2', pod: 'none' });
    const first = await ensureCirclePod(circleId, await policy.get(circleId));
    expect(first?.podClient, 'no producer: the rest would be vacuous').toBeTruthy();

    const uri = `pseudo-pod://circle-${circleId}/circle/items/note.json`;
    await first.podClient.write(uri, JSON.stringify({ text: 'kept' }), { contentType: 'application/json' });
    const scopePrefix = `basis.circle-${circleId}:`;
    const rowKey = [...storage.raw.keys()].find((k) => k.startsWith(scopePrefix) && k.includes('note.json') && !k.includes('__dirty__') && !k.includes('versions/'));
    expect(rowKey, 'the row did not reach the circle scope').toBeTruthy();
    // The row on the disk now sealed with ANOTHER content key: on this device it does not open (a key that changed,
    // a restored backup). Written beside the app, straight onto the same AsyncStorage scope.
    const otherKey = createSealingBackend({ backend: createAsBackend({ AsyncStorage: storage, scope: `basis.circle-${circleId}` }), getStrategy: async () => groupKeyStrategy({ groupKey: 'B'.repeat(43) }) });
    await otherKey.put(rowKey.slice(scopePrefix.length), new TextEncoder().encode(JSON.stringify({ text: 'kept' })));
    const before = storage.raw.get(rowKey);

    // A posture change drops the producer; the rebuilt store (a NEW backend object over the same scope, nothing held in
    // memory) reads the row: it will not open, the ref is marked.
    const rebuild = async (storagePosture) => {
      await policy.update(circleId, { storagePosture });
      const p = await ensureCirclePod(circleId, await policy.get(circleId));
      expect(p?.podClient, 'rebuilt').toBeTruthy();
      return p;
    };
    const second = await rebuild('p3');
    expect(second.podClient, 'a new store').not.toBe(first.podClient);
    const read = await second.podClient.read(uri, { decode: 'text' }).then((r) => r?.content ?? null, () => null);
    expect(read, 'the row opened: the probe proves nothing').not.toBe(JSON.stringify({ text: 'kept' }));

    // Rebuilt AGAIN (another posture change): the write over the row it could not open is refused.
    const third = await rebuild('p2');
    expect(third.podClient, 'a new store').not.toBe(second.podClient);
    const err = await third.podClient.write(uri, JSON.stringify({ text: 'over it' }), { contentType: 'application/json' }).then(() => null, (e) => e);
    expect(storage.raw.get(rowKey), 'the value it could not open was written over').toBe(before);
    expect(err?.code ?? err?.cause?.code).toBe('stored-value-unreadable');
  }, 60_000);

  // The circle CACHE of a pod-backed circle has no displaced-bytes history, so its write does not read first: there the
  // refusal is only what an earlier read left, and a rebuilt medium (a new backend object) must still find it.
  it("a pod-backed circle's cache, provisioned again, still refuses to write over a value it could not open", async () => {
    const storage = mockAsyncStorage();
    initCirclePods(storage);
    const circleId = 'c-cache-refusal';
    await makeCirclePolicyStoreRN(storage).update(circleId, { storagePosture: 'p2', pod: 'shared' });

    const ref = `pseudo-pod://circle-cache-${circleId}/circle/items/note.json`;
    const otherKey = createSealingBackend({ backend: createAsBackend({ AsyncStorage: storage, scope: `basis.circle-cache-${circleId}` }), getStrategy: async () => groupKeyStrategy({ groupKey: 'B'.repeat(43) }) });
    await otherKey.put(ref, new TextEncoder().encode(JSON.stringify({ text: 'kept' })));
    const rowKey = `basis.circle-cache-${circleId}:${ref}`;
    const before = storage.raw.get(rowKey);
    expect(before, 'the row is not where the cache reads').toBeTruthy();

    const first = await provisionCircleMedium(circleId);
    expect(first, 'no cache medium: the rest would be vacuous').toBeTruthy();
    expect(await first.read(ref).catch(() => null), 'the row opened: the probe proves nothing').toBe(null);

    const second = await provisionCircleMedium(circleId);
    expect(second).not.toBe(first);
    const err = await second.write(ref, JSON.stringify({ text: 'over it' })).then(() => null, (e) => e);
    expect(storage.raw.get(rowKey), 'the value it could not open was written over').toBe(before);
    expect(err?.code ?? err?.cause?.code).toBe('stored-value-unreadable');
  }, 60_000);

  // One naming rule for every shell: a circle's storage name is never typed at a call site, so web and phone cannot
  // name (or scope) the same storage differently.
  it('neither shell types a circle storage name itself', () => {
    for (const f of ['../src/core/circlePods.js', '../../basis/web/v2/circleApp.js']) {
      const src = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      expect(src, f).not.toMatch(/`basis.circle-(cache-)?\$\{/);
      expect(src, f).toContain('sealedNamedBackend(circleStorageName.store(circleId)');
      expect(src, f).toContain('sealedNamedBackend(circleStorageName.cache(circleId)');
    }
  });
});
