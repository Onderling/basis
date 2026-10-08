// 5.4c (2026-05-30) — mobile pod-mirror wiring for the v2 circle policy
// store.
//
// Proves the seam App.js wires:
//   - `buildCirclePodWriter(session)` returns a real writer when the
//     OidcSessionRN-shaped object is authenticated, and `null` (never
//     throws) when it isn't.
//   - The launcher's `makeCirclePolicyStoreRN(storage, { getPodWriter })`
//     mirrors a `pod !== 'none'` save to BOTH AsyncStorage AND the pod
//     writer, but stays local-only when `getPodWriter()` returns null
//     (the pre-restore state) OR when the policy's `pod` axis is the
//     default `'none'`.
//
// The real `createPodWriter` + `discoverPodRoot` are injected as fakes,
// so this test never touches the network.
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../basis/src/v2/localStoreSeal.js';
const SEAL = groupKeyStrategy({ groupKey: 'A'.repeat(43) });
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  buildCirclePodWriter, makeCirclePolicyStoreRN,
} from '../src/core/circleStoresRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

/** Fake OidcSessionRN with the minimal surface buildCirclePodWriter touches. */
function fakeSession({ webid = 'https://alice.example/profile/card#me', authed = true } = {}) {
  return {
    isAuthenticated: () => authed,
    get webid() { return webid; },
    getAuthenticatedFetch() {
      // Never actually called in these tests (the writer is a fake),
      // but the helper grabs it before constructing the shim.
      return async () => ({ ok: false, status: 0 });
    },
  };
}

/** A `createPodWriter`-shaped fake the policy IO can read/write. */
function fakePodWriter() {
  const writes = [];
  const reads  = new Map(); // key: `${app}|${resource}` → body string
  return {
    writes, reads,
    webid:   'https://alice.example/profile/card#me',
    podRoot: 'https://alice.example/',
    write: async (app, resource, body, contentType) => {
      writes.push({ app, resource, body, contentType });
      reads.set(`${app}|${resource}`, body);
      return { ok: true, status: 201, url: `https://alice.example/${app}/${resource}` };
    },
    read: async (app, resource) => {
      const body = reads.get(`${app}|${resource}`);
      if (body == null) return { ok: false, status: 404 };
      return { ok: true, status: 200, body, contentType: 'application/json' };
    },
  };
}

describe('5.4c buildCirclePodWriter', () => {
  it('returns null when session is missing', async () => {
    expect(await buildCirclePodWriter(null)).toBeNull();
  });

  it('returns null when session is not authenticated', async () => {
    const s = fakeSession({ authed: false });
    expect(await buildCirclePodWriter(s)).toBeNull();
  });

  it('returns null when session has no webid', async () => {
    const s = fakeSession({ webid: null });
    expect(await buildCirclePodWriter(s)).toBeNull();
  });

  it('builds a writer when the session is authenticated (injected deps)', async () => {
    const s = fakeSession();
    let discoverCalls = 0;
    let createCalls = 0;
    const fakeWriter = fakePodWriter();
    const writer = await buildCirclePodWriter(s, {
      discoverPodRoot: async (shim) => {
        discoverCalls += 1;
        // Asserts the shim shape: fetch + webid pulled off the session.
        expect(typeof shim.fetch).toBe('function');
        expect(shim.webid).toBe(s.webid);
        return 'https://alice.example/';
      },
      createPodWriter: (shim, opts) => {
        createCalls += 1;
        expect(opts.podRoot).toBe('https://alice.example/');
        return fakeWriter;
      },
    });
    expect(writer).toBe(fakeWriter);
    expect(discoverCalls).toBe(1);
    expect(createCalls).toBe(1);
  });

  it('still returns a writer when discoverPodRoot fails (URL heuristic fallback)', async () => {
    const s = fakeSession();
    const fakeWriter = fakePodWriter();
    const writer = await buildCirclePodWriter(s, {
      discoverPodRoot: async () => { throw new Error('network'); },
      createPodWriter: (_shim, opts) => {
        // No podRoot → createPodWriter falls back to the WebID heuristic.
        expect(opts.podRoot).toBeUndefined();
        return fakeWriter;
      },
    });
    expect(writer).toBe(fakeWriter);
  });
});

describe('5.4c makeCirclePolicyStoreRN with getPodWriter thunk', () => {
  let storage;
  // the app saves a policy only after boot, when the content key exists (the policy is sealed at rest)
  beforeEach(() => { storage = mockAsyncStorage(); setShellContentSeal(SEAL); });
  afterEach(() => setShellContentSeal(null));

  it('mirrors a pod-shared save to BOTH AsyncStorage AND the pod writer', async () => {
    const writer = fakePodWriter();
    const store = makeCirclePolicyStoreRN(storage, { getPodWriter: () => writer });

    await store.update('circle-1', { pod: 'shared', llmTool: 'local' });

    // Local (canonical) write landed under the cc.circlePolicy.<id> key.
    expect([...storage.map.keys()]).toContain('cc.circlePolicy.circle-1');
    // sealed at rest: opened with the device's content key
    const localValue = JSON.parse(SEAL.open(storage.map.get('cc.circlePolicy.circle-1')));
    expect(localValue.pod).toBe('shared');
    expect(localValue.llmTool).toBe('local');

    // Pod mirror landed via the writer with the canonical JSON.
    expect(writer.writes).toHaveLength(1);
    expect(writer.writes[0].app).toBe('cc-circle');
    expect(writer.writes[0].resource).toBe('circle.circle-1.json');
    expect(writer.writes[0].contentType).toBe('application/json');
    expect(JSON.parse(writer.writes[0].body).pod).toBe('shared');
  });

  it('skips the pod mirror when getPodWriter() returns null (pre-restore)', async () => {
    const writer = fakePodWriter();
    let sessionReady = false;
    const store = makeCirclePolicyStoreRN(storage, {
      // Mimics App.js's `() => circlePodWriterRef.current` — flips from
      // null to a writer once the session restores.
      getPodWriter: () => (sessionReady ? writer : null),
    });

    // Pre-restore save: pod axis says 'shared' but no writer → local-only.
    await store.update('circle-2', { pod: 'shared' });
    expect(writer.writes).toHaveLength(0);
    expect([...storage.map.keys()]).toContain('cc.circlePolicy.circle-2');

    // Session restores → next save picks the writer up via the SAME store
    // (no re-render, no rebuild).
    sessionReady = true;
    await store.update('circle-2', { llmTool: 'cloud' });
    expect(writer.writes).toHaveLength(1);
    expect(writer.writes[0].resource).toBe('circle.circle-2.json');
    // Mirror carries the merged value (pod stayed 'shared').
    expect(JSON.parse(writer.writes[0].body).pod).toBe('shared');
    expect(JSON.parse(writer.writes[0].body).llmTool).toBe('cloud');
  });

  it('does NOT mirror when the policy keeps the default pod:"none"', async () => {
    const writer = fakePodWriter();
    const store = makeCirclePolicyStoreRN(storage, { getPodWriter: () => writer });

    // Default policy has pod:'none' — tieredPolicyIo intentionally
    // refuses to publish (a private circle stays local).
    await store.update('circle-3', { llmTool: 'local' });
    expect([...storage.map.keys()]).toContain('cc.circlePolicy.circle-3');
    expect(writer.writes).toHaveLength(0);
  });
});
