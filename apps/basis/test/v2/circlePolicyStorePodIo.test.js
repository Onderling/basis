/**
 * Phase 5.4a — podPolicyIo + tieredPolicyIo.
 *
 * podPolicyIo round-trips JSON through a `createPodWriter`-shaped
 * writer; tieredPolicyIo composes local (canonical) + pod (mirror)
 * IO and enforces the `pod` axis on writes.  Both compose through
 * `createCirclePolicyStore` so the integration test exercises the
 * real persistence path the host wires.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCirclePolicyStore,
  podPolicyIo,
  tieredPolicyIo,
} from '../../src/v2/circlePolicyStore.js';
import { createPodWriter } from '../../src/web/podStorage.js';

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

/** In-memory IO that records every write so tests can assert behaviour. */
function makeMemIo() {
  const data = new Map();
  return {
    data,
    load: async (id) => (data.has(id) ? data.get(id) : null),
    save: async (id, value) => { data.set(id, value); },
  };
}

describe('podPolicyIo', () => {
  it('the policy\'s pod tier never reads a cached copy: another member\'s newer policy on the pod is what it loads', async () => {
    // A browser's fetch keeps an HTTP cache (and the phone's OkHttp a disk one): a GET without a cache mode can be answered
    // with an OLD body after the pod changed. The pod writer's reads ask the pod (`cache: 'no-cache'`), as pod-client's
    // own requests do. This fetch answers from its cache unless a request asks to revalidate.
    let onPod = JSON.stringify({ pod: 'shared', version: 1 });
    const cache = new Map();
    const fetch = async (url, init = {}) => {
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'PUT') { onPod = String(init.body); return new Response(null, { status: 201 }); }
      const key = `${method} ${url}`;
      const revalidates = init.cache === 'no-cache' || init.cache === 'no-store' || init.cache === 'reload';
      if (!revalidates && cache.has(key)) return cache.get(key).clone();
      const res = new Response(method === 'HEAD' ? null : onPod, { status: 200, headers: { 'content-type': 'application/json' } });
      cache.set(key, res.clone());
      return res;
    };
    const writer = createPodWriter({ webid: 'https://pod.example/me/profile/card#me', fetch }, { podRoot: 'https://pod.example/me/' });
    const io = podPolicyIo({ getWriter: () => writer });
    expect((await io.load('c1'))?.version).toBe(1);
    onPod = JSON.stringify({ pod: 'shared', version: 2 });   // another member's device changed the policy on the pod
    expect((await io.load('c1'))?.version).toBe(2);
  });

  it('is a no-op when getWriter returns null', async () => {
    const io = podPolicyIo({ getWriter: () => null });
    expect(await io.load('c1')).toBeNull();
    await io.save('c1', { hello: 'world' });   // does not throw
    expect(await io.load('c1')).toBeNull();
  });

  it('round-trips JSON through the writer (default app)', async () => {
    const writer = makeMockPodWriter();
    const io = podPolicyIo({ getWriter: () => writer });
    await io.save('c1', { pod: 'shared', features: { a: true } });
    const out = await io.load('c1');
    expect(out).toEqual({ pod: 'shared', features: { a: true } });
    // The resource path follows the convention `circle.<id>.json`.
    expect(writer.store.has('cc-circle::circle.c1.json')).toBe(true);
  });

  it('honours a custom app segment', async () => {
    const writer = makeMockPodWriter();
    const io = podPolicyIo({ getWriter: () => writer, app: 'cc-override' });
    await io.save('c1', { ok: 1 });
    expect(writer.store.has('cc-override::circle.c1.json')).toBe(true);
  });

  it("survives a writer that throws or returns !ok (load → null, save swallowed)", async () => {
    const bad = {
      read:  async () => { throw new Error('boom'); },
      write: async () => { throw new Error('boom'); },
    };
    const io = podPolicyIo({ getWriter: () => bad });
    expect(await io.load('c1')).toBeNull();
    await expect(io.save('c1', { a: 1 })).resolves.toBeUndefined();
  });

  it('throws when constructed without a getWriter thunk', () => {
    expect(() => podPolicyIo({})).toThrow(/getWriter/);
  });
});

describe('tieredPolicyIo — reads', () => {
  it('returns the local value when present (pod not consulted)', async () => {
    const local = makeMemIo();  local.data.set('c1', { pod: 'shared', from: 'local' });
    const pod   = makeMemIo();  pod.data.set('c1',   { pod: 'shared', from: 'pod'   });
    const tiered = tieredPolicyIo(local, pod);
    expect(await tiered.load('c1')).toEqual({ pod: 'shared', from: 'local' });
  });

  it('falls back to pod when local is empty AND seeds local', async () => {
    const local = makeMemIo();
    const pod   = makeMemIo();  pod.data.set('c1', { pod: 'shared', from: 'pod' });
    const tiered = tieredPolicyIo(local, pod);
    const out = await tiered.load('c1');
    expect(out).toEqual({ pod: 'shared', from: 'pod' });
    expect(local.data.get('c1')).toEqual({ pod: 'shared', from: 'pod' });  // cached down
  });

  it('returns null when neither side has it', async () => {
    const tiered = tieredPolicyIo(makeMemIo(), makeMemIo());
    expect(await tiered.load('c1')).toBeNull();
  });
});

describe('tieredPolicyIo — writes enforce the pod axis', () => {
  let local, pod, tiered;
  beforeEach(() => {
    local  = makeMemIo();
    pod    = makeMemIo();
    tiered = tieredPolicyIo(local, pod);
  });

  it("mirrors to pod when value.pod === 'shared'", async () => {
    await tiered.save('c1', { pod: 'shared', features: { a: true } });
    expect(local.data.get('c1')).toEqual({ pod: 'shared', features: { a: true } });
    expect(pod.data.get('c1')).toEqual({ pod: 'shared', features: { a: true } });
  });

  it("does NOT mirror to pod when value.pod === 'none'", async () => {
    await tiered.save('c1', { pod: 'none', features: { a: true } });
    expect(local.data.get('c1')).toBeDefined();
    expect(pod.data.has('c1')).toBe(false);
  });

  it("does NOT mirror when value.pod is missing (treated as 'none')", async () => {
    await tiered.save('c1', { features: { a: true } });
    expect(local.data.get('c1')).toBeDefined();
    expect(pod.data.has('c1')).toBe(false);
  });

  it("mirrors for any non-'none' value (personal/hybrid also publish)", async () => {
    await tiered.save('c1', { pod: 'personal' });
    await tiered.save('c2', { pod: 'hybrid'   });
    expect(pod.data.get('c1').pod).toBe('personal');
    expect(pod.data.get('c2').pod).toBe('hybrid');
  });

  it('honours a custom shouldMirror', async () => {
    const t = tieredPolicyIo(makeMemIo(), pod, { shouldMirror: () => true });
    await t.save('c1', { pod: 'none' });
    expect(pod.data.has('c1')).toBe(true);
  });
});

describe('end-to-end through createCirclePolicyStore', () => {
  it('a shared-pod policy update writes to local AND mirrors to the pod', async () => {
    const writer = makeMockPodWriter();
    const local  = makeMemIo();
    const tiered = tieredPolicyIo(local, podPolicyIo({ getWriter: () => writer }));
    const store  = createCirclePolicyStore(tiered);

    const updated = await store.update('circle-x', { pod: 'shared', features: {} });
    expect(updated.pod).toBe('shared');
    expect(local.data.has('circle-x')).toBe(true);
    expect(writer.store.has('cc-circle::circle.circle-x.json')).toBe(true);
  });

  it("a default ('none') policy update stays local-only", async () => {
    const writer = makeMockPodWriter();
    const tiered = tieredPolicyIo(makeMemIo(), podPolicyIo({ getWriter: () => writer }));
    const store  = createCirclePolicyStore(tiered);

    await store.update('circle-y', { features: { a: true } });   // pod defaults to 'none'
    expect(writer.store.has('cc-circle::circle.circle-y.json')).toBe(false);
  });

  it('a member joining a shared-pod circle picks up policy from pod on first read', async () => {
    // Publisher writes to pod via the tiered IO.
    const writer = makeMockPodWriter();
    {
      const publisher = createCirclePolicyStore(
        tieredPolicyIo(makeMemIo(), podPolicyIo({ getWriter: () => writer })),
      );
      await publisher.update('circle-z', { pod: 'shared', features: { chat: true } });
    }
    // A fresh joiner has empty local but the same pod → reads through.
    const joinerLocal = makeMemIo();
    const joiner = createCirclePolicyStore(
      tieredPolicyIo(joinerLocal, podPolicyIo({ getWriter: () => writer })),
    );
    const seen = await joiner.get('circle-z');
    expect(seen.pod).toBe('shared');
    expect(seen.features.chat).toBe(true);
    expect(joinerLocal.data.has('circle-z')).toBe(true);   // seeded local
  });

  it('with no pod writer wired (getWriter→null), behaviour is identical to local-only', async () => {
    const local  = makeMemIo();
    const tiered = tieredPolicyIo(local, podPolicyIo({ getWriter: () => null }));
    const store  = createCirclePolicyStore(tiered);
    await store.update('circle-q', { pod: 'shared', features: { a: true } });
    expect(local.data.has('circle-q')).toBe(true);
    // No writer → nothing mirrored anywhere else; system is unchanged.
  });
});
