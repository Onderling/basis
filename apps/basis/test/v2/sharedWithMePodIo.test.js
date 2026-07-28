/**
 * TIERED "shared with me" persistence (Frits' call) — received sealed copies
 * SURVIVE + SYNC across the user's devices.
 *
 * `podSharedWithMeIo` mirrors the per-user received list to a pod resource
 * through a `createPodWriter`-shaped writer; `tieredSharedWithMeIo` composes
 * local (canonical) + pod (mirror), merging both on hydrate by copy id. Both
 * compose through `createSharedWithMeStore` so the integration test exercises
 * the real persistence path the shell wires — and proves a copy received +
 * saved on one device is read back by a SEPARATE (cross-device) store through
 * the shared pod. Mirrors `memberAvailabilityPodIo.test.js`.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createSharedWithMeStore,
  podSharedWithMeIo,
  tieredSharedWithMeIo,
} from '../../src/v2/sharedWithMeStore.js';

/** In-memory podWriter (read/write JSON keyed by `${app}::${resource}`). */
function makeMockPodWriter() {
  const store = new Map();
  const key = (app, resource) => `${app}::${resource}`;
  return {
    store,
    read: async (app, resource) => {
      const body = store.get(key(app, resource));
      return body == null
        ? { ok: false, body: null, status: 404 }
        : { ok: true, body, status: 200 };
    },
    write: async (app, resource, body) => {
      store.set(key(app, resource), body);
      return { ok: true, status: 200, url: key(app, resource) };
    },
  };
}

/** In-memory IO that records every write so tests can assert. */
function makeMemIo() {
  let value = null;
  return {
    get value() { return value; },
    load: async () => value,
    save: async (v) => { value = v; },
  };
}

/** A received sealed copy shaped like the `shared-copy` handler lands. */
function copy(id, receivedAt = Date.now()) {
  return {
    sealed: { id, ct: `ciphertext-${id}` },
    itemMeta: { copyId: id, kind: 'note' },
    from: 'peer-webid',
    receivedAt,
  };
}

describe('podSharedWithMeIo', () => {
  it('is a no-op when getWriter returns null', async () => {
    const io = podSharedWithMeIo({ getWriter: () => null });
    expect(await io.load()).toBeNull();
    await io.save([copy('a')]);   // does not throw
    expect(await io.load()).toBeNull();
  });

  it('round-trips the list through the writer at the per-user resource', async () => {
    const writer = makeMockPodWriter();
    const io = podSharedWithMeIo({ getWriter: () => writer });
    const list = [copy('a', 2), copy('b', 1)];
    await io.save(list);
    expect(await io.load()).toEqual(list);
    // Per-user resource under the shared-with-me app segment (→ onderling/cc-shared-with-me/received.json).
    expect(writer.store.has('cc-shared-with-me::received.json')).toBe(true);
  });

  it('honours a custom app segment', async () => {
    const writer = makeMockPodWriter();
    const io = podSharedWithMeIo({ getWriter: () => writer, app: 'cc-swm-alt' });
    await io.save([copy('a')]);
    expect(writer.store.has('cc-swm-alt::received.json')).toBe(true);
  });

  it('survives a writer that throws (load → null, save swallowed)', async () => {
    const bad = {
      read:  async () => { throw new Error('boom'); },
      write: async () => { throw new Error('boom'); },
    };
    const io = podSharedWithMeIo({ getWriter: () => bad });
    expect(await io.load()).toBeNull();
    await expect(io.save([copy('a')])).resolves.toBeUndefined();
  });

  it('throws when constructed without a getWriter thunk', () => {
    expect(() => podSharedWithMeIo({})).toThrow(/getWriter/);
  });
});

describe('tieredSharedWithMeIo', () => {
  it('read returns local-only when the pod is empty', async () => {
    const local = makeMemIo(); await local.save([copy('a', 1)]);
    const pod   = makeMemIo();
    const tiered = tieredSharedWithMeIo(local, pod);
    expect((await tiered.load()).map((e) => e.id)).toEqual(['a']);
  });

  it('read MERGES local + pod by copy id (union, newest-first) AND seeds local', async () => {
    const local = makeMemIo(); await local.save([copy('local', 1)]);
    const pod   = makeMemIo(); await pod.save([copy('pod', 2)]);
    const tiered = tieredSharedWithMeIo(local, pod);
    const merged = await tiered.load();
    expect(merged.map((e) => e.id)).toEqual(['pod', 'local']);   // newest-first
    // pod-only copy seeded into local so it persists offline.
    expect(local.value.map((e) => e.id).sort()).toEqual(['local', 'pod']);
  });

  it('read dedupes a copy present on BOTH sides (no double row)', async () => {
    const local = makeMemIo(); await local.save([copy('dup', 1)]);
    const pod   = makeMemIo(); await pod.save([copy('dup', 1)]);
    const merged = await tieredSharedWithMeIo(local, pod).load();
    expect(merged.map((e) => e.id)).toEqual(['dup']);
  });

  it('write ALWAYS mirrors to pod (list written verbatim to both sides)', async () => {
    const local = makeMemIo();
    const pod   = makeMemIo();
    const list = [copy('a')];
    await tieredSharedWithMeIo(local, pod).save(list);
    expect(local.value).toEqual(list);
    expect(pod.value).toEqual(list);
  });

  it('read returns [] when neither side has anything', async () => {
    expect(await tieredSharedWithMeIo(makeMemIo(), makeMemIo()).load()).toEqual([]);
  });
});

describe('end-to-end through createSharedWithMeStore', () => {
  let writer;
  beforeEach(() => { writer = makeMockPodWriter(); });

  it('add() persists locally AND publishes the sealed copy to the pod', async () => {
    const local = makeMemIo();
    const store = createSharedWithMeStore(
      tieredSharedWithMeIo(local, podSharedWithMeIo({ getWriter: () => writer })),
    );
    const after = await store.add(copy('c1'));
    expect(after.map((e) => e.id)).toEqual(['c1']);
    expect(local.value.map((e) => e.id)).toEqual(['c1']);                 // local canonical
    expect(writer.store.has('cc-shared-with-me::received.json')).toBe(true); // published
  });

  it('a SEPARATE store (another device), SAME pod, reads the received copy back', async () => {
    // Device A receives + saves a copy.
    {
      const deviceA = createSharedWithMeStore(
        tieredSharedWithMeIo(makeMemIo(), podSharedWithMeIo({ getWriter: () => writer })),
      );
      await deviceA.add(copy('c1', 10));
      await deviceA.add(copy('c2', 20));
    }
    // Device B — fresh local, SAME pod — hydrates the published list on first list().
    const deviceBLocal = makeMemIo();
    const deviceB = createSharedWithMeStore(
      tieredSharedWithMeIo(deviceBLocal, podSharedWithMeIo({ getWriter: () => writer })),
    );
    const seen = await deviceB.list();
    expect(seen.map((e) => e.id)).toEqual(['c2', 'c1']);          // newest-first
    expect(seen[0].sealed).toEqual({ id: 'c2', ct: 'ciphertext-c2' });
    expect(deviceBLocal.value).not.toBeNull();                   // seeded local from pod
  });

  it('with no pod writer wired (getWriter→null), behaviour is LOCAL-ONLY + unchanged', async () => {
    const local = makeMemIo();
    const store = createSharedWithMeStore(
      tieredSharedWithMeIo(local, podSharedWithMeIo({ getWriter: () => null })),
    );
    await store.add(copy('c1'));
    expect(local.value.map((e) => e.id)).toEqual(['c1']);
    // Nothing mirrored anywhere else; a fresh reader with an empty pod sees an empty list.
    const fresh = createSharedWithMeStore(
      tieredSharedWithMeIo(makeMemIo(), podSharedWithMeIo({ getWriter: () => null })),
    );
    expect(await fresh.list()).toEqual([]);
  });
});
