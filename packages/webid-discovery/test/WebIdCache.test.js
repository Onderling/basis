/**
 * WebIdCache — unit tests.
 *
 * Covers:
 *   - construction validation (webid + fetch required)
 *   - refresh() populates pointers + resolved
 *   - 'refresh' event fires with new state
 *   - heartbeat refresh fires on cadence
 *   - 'error' event fires when refresh fails during heartbeat
 *   - heartbeat is idempotent (start twice = one interval)
 *   - close() / stop() tears down cleanly
 *   - operating without a reader → resolved stays empty
 *   - pointer disappears between refreshes → corresponding resolved key clears
 *   - per-pointer read failure leaves previous value in place
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebIdCache } from '../src/WebIdCache.js';

const WEBID = 'https://alice.example/profile/card#me';

function turtleProfile({ storageMapping, agentRegistry, auditLog } = {}) {
  const lines = [`<${WEBID}> <http://xmlns.com/foaf/0.1/> "name" .`];
  if (storageMapping) lines.push(`<${WEBID}> <https://onderling.org/ns#storage-mapping-uri> <${storageMapping}> .`);
  if (agentRegistry)  lines.push(`<${WEBID}> <https://onderling.org/ns#agent-registry-uri>  <${agentRegistry}> .`);
  if (auditLog)       lines.push(`<${WEBID}> <https://onderling.org/ns#audit-log-uri>       <${auditLog}> .`);
  return lines.join('\n');
}

function makeFetch(body) {
  return async () => new Response(body, { status: 200, headers: { 'content-type': 'text/turtle' } });
}

function makeReader(store) {
  return async (uri) => store.get(uri) ?? null;
}

/* ────────────────────────────────────────────────────────────────────────── */

describe('WebIdCache — construction', () => {
  it('requires webid', () => {
    expect(() => new WebIdCache({ fetch: async () => new Response() }))
      .toThrow(/webid/i);
  });

  it('requires fetch to be a function', () => {
    expect(() => new WebIdCache({ webid: WEBID, fetch: null }))
      .toThrow(/fetch/i);
  });

  it('starts with empty pointers + resolved', () => {
    const cache = new WebIdCache({ webid: WEBID, fetch: async () => new Response() });
    expect(cache.pointers).toEqual({});
    expect(cache.resolved).toEqual({});
    expect(cache.storageMapping).toBe(null);
    expect(cache.agentRegistry).toBe(null);
    expect(cache.auditLog).toBe(null);
    expect(cache.lastRefreshAt).toBe(null);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('WebIdCache — refresh', () => {
  it('populates pointers and resolved on first refresh', async () => {
    const body = turtleProfile({
      storageMapping: 'https://alice.pod/private/storage-mapping',
      agentRegistry:  'https://alice.pod/private/agent-registry',
    });
    const store = new Map([
      ['https://alice.pod/private/storage-mapping', { defaultPolicy: 'one-pod' }],
      ['https://alice.pod/private/agent-registry',  { agents: [{ id: 'a' }] }],
    ]);

    const cache = new WebIdCache({
      webid: WEBID,
      fetch: makeFetch(body),
      read:  makeReader(store),
      heartbeatMs: 0,
    });

    await cache.refresh();
    expect(cache.pointers).toEqual({
      storageMappingUri: 'https://alice.pod/private/storage-mapping',
      agentRegistryUri:  'https://alice.pod/private/agent-registry',
    });
    expect(cache.storageMapping).toEqual({ defaultPolicy: 'one-pod' });
    expect(cache.agentRegistry).toEqual({ agents: [{ id: 'a' }] });
    expect(cache.auditLog).toBe(null);
    expect(cache.lastRefreshAt).toBeGreaterThan(0);
    expect(cache.raw).toContain('storage-mapping-uri');
  });

  it("emits 'refresh' with the new state", async () => {
    const body = turtleProfile({ storageMapping: 'https://alice.pod/private/storage-mapping' });
    const cache = new WebIdCache({
      webid: WEBID,
      fetch: makeFetch(body),
      read:  makeReader(new Map([['https://alice.pod/private/storage-mapping', 'value']])),
      heartbeatMs: 0,
    });

    const events = [];
    cache.on('refresh', (state) => events.push(state));
    await cache.refresh();

    expect(events).toHaveLength(1);
    expect(events[0].pointers.storageMappingUri).toBe('https://alice.pod/private/storage-mapping');
    expect(events[0].resolved.storageMapping).toBe('value');
  });

  it('returns empty resolved when no reader is supplied', async () => {
    const body = turtleProfile({ storageMapping: 'https://alice.pod/private/storage-mapping' });
    const cache = new WebIdCache({
      webid: WEBID,
      fetch: makeFetch(body),
      heartbeatMs: 0,
      // no read
    });
    await cache.refresh();
    expect(cache.pointers.storageMappingUri).toBe('https://alice.pod/private/storage-mapping');
    expect(cache.storageMapping).toBe(null);
  });

  it('clears resolved keys whose pointer disappears between refreshes', async () => {
    let bodyVariant = 'both';
    const fetch = async () => {
      const body = bodyVariant === 'both'
        ? turtleProfile({
            storageMapping: 'https://alice.pod/private/storage-mapping',
            agentRegistry:  'https://alice.pod/private/agent-registry',
          })
        : turtleProfile({ storageMapping: 'https://alice.pod/private/storage-mapping' });
      return new Response(body, { status: 200 });
    };
    const store = new Map([
      ['https://alice.pod/private/storage-mapping', 'sm-v1'],
      ['https://alice.pod/private/agent-registry',  'ar-v1'],
    ]);

    const cache = new WebIdCache({ webid: WEBID, fetch, read: makeReader(store), heartbeatMs: 0 });
    await cache.refresh();
    expect(cache.agentRegistry).toBe('ar-v1');

    bodyVariant = 'only-storage';
    await cache.refresh();
    expect(cache.storageMapping).toBe('sm-v1');
    expect(cache.agentRegistry).toBe(null);
  });

  it('keeps the previous value when per-pointer read fails', async () => {
    const body = turtleProfile({
      storageMapping: 'https://alice.pod/private/storage-mapping',
      agentRegistry:  'https://alice.pod/private/agent-registry',
    });
    let firstPass = true;
    const read = async (uri) => {
      if (firstPass) return { from: uri, v: 1 };
      if (uri.endsWith('agent-registry')) throw new Error('boom');
      return { from: uri, v: 2 };
    };

    const cache = new WebIdCache({ webid: WEBID, fetch: makeFetch(body), read, heartbeatMs: 0 });
    cache.on('error', () => { /* swallow */ });

    await cache.refresh();
    expect(cache.agentRegistry).toEqual({ from: 'https://alice.pod/private/agent-registry', v: 1 });

    firstPass = false;
    await cache.refresh();
    expect(cache.storageMapping).toEqual({ from: 'https://alice.pod/private/storage-mapping', v: 2 });
    // agent-registry read failed; previous value kept.
    expect(cache.agentRegistry).toEqual({ from: 'https://alice.pod/private/agent-registry', v: 1 });
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('WebIdCache — heartbeat', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(()  => { vi.useRealTimers(); });

  it('refreshes on cadence after start()', async () => {
    let calls = 0;
    const fetch = async () => { calls++; return new Response(turtleProfile({}), { status: 200 }); };
    const cache = new WebIdCache({ webid: WEBID, fetch, heartbeatMs: 1_000 });

    cache.start();
    expect(calls).toBe(0);  // no immediate refresh

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);

    cache.stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toBe(2);   // stopped
  });

  it("emits 'error' when a heartbeat refresh fails", async () => {
    const fetch = async () => new Response('', { status: 500 });
    const cache = new WebIdCache({ webid: WEBID, fetch, heartbeatMs: 1_000 });

    const errors = [];
    cache.on('error', e => errors.push(e));

    cache.start();
    await vi.advanceTimersByTimeAsync(1_000);
    // give the rejected refresh promise a tick to settle
    await Promise.resolve();
    await Promise.resolve();

    expect(errors.length).toBeGreaterThan(0);
    cache.stop();
  });

  it('start() is idempotent', async () => {
    let calls = 0;
    const fetch = async () => { calls++; return new Response(turtleProfile({}), { status: 200 }); };
    const cache = new WebIdCache({ webid: WEBID, fetch, heartbeatMs: 1_000 });

    cache.start();
    cache.start();  // second call should be a no-op
    cache.start();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(1);   // exactly one interval, not three
    cache.stop();
  });

  it('heartbeatMs: 0 disables auto-refresh', async () => {
    let calls = 0;
    const fetch = async () => { calls++; return new Response(turtleProfile({}), { status: 200 }); };
    const cache = new WebIdCache({ webid: WEBID, fetch, heartbeatMs: 0 });

    cache.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────── */

describe('WebIdCache — close', () => {
  it('close() tears down the heartbeat', () => {
    const cache = new WebIdCache({
      webid: WEBID,
      fetch: async () => new Response(turtleProfile({}), { status: 200 }),
      heartbeatMs: 1_000,
    });
    cache.start();
    cache.close();
    // No assertion needed beyond not-throwing; interval cleared.
  });
});
