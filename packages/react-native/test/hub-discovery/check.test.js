/**
 * hub-discovery.check — query + cache semantics with a mocked
 * native module.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createDiscoveryCache } from '../../src/hub-discovery/cache.js';
import { check, DEFAULT_INTENT_ACTION } from '../../src/hub-discovery/check.js';

function nativeMock(queueOrFn) {
  const calls = [];
  let nextIdx = 0;
  return {
    calls,
    async queryHubService(intentAction) {
      calls.push(intentAction);
      if (typeof queueOrFn === 'function') return queueOrFn(intentAction);
      const value = Array.isArray(queueOrFn) ? queueOrFn[nextIdx++] : queueOrFn;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

describe('check — input validation', () => {
  it('rejects missing nativeModule', async () => {
    await expect(check({ cache: createDiscoveryCache() }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing cache', async () => {
    await expect(check({ nativeModule: nativeMock({ hubInstalled: false }) }))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('check — happy path (Hub installed)', () => {
  let cache; beforeEach(() => { cache = createDiscoveryCache(); });

  it('returns normalised result + caches it', async () => {
    const native = nativeMock({
      hubInstalled:      true,
      hubVersion:        1,
      packageName:       'org.onderling.hub',
      serviceName:       'org.onderling.hub.HubService',
      supportedVersions: [1, 2],
    });
    const result = await check({ nativeModule: native, cache });
    expect(result.hubInstalled).toBe(true);
    expect(result.hubVersion).toBe(1);
    expect(result.packageName).toBe('org.onderling.hub');
    expect(result.supportedVersions).toEqual([1, 2]);
    expect(typeof result.checkedAt).toBe('string');
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('second call hits the cache (no second native query)', async () => {
    const native = nativeMock({ hubInstalled: true, hubVersion: 1 });
    await check({ nativeModule: native, cache });
    await check({ nativeModule: native, cache });
    expect(native.calls).toHaveLength(1);
  });

  it('cache.invalidate forces a re-query', async () => {
    const native = nativeMock([
      { hubInstalled: true,  hubVersion: 1 },
      { hubInstalled: false },
    ]);
    const r1 = await check({ nativeModule: native, cache });
    expect(r1.hubInstalled).toBe(true);
    cache.invalidate();
    const r2 = await check({ nativeModule: native, cache });
    expect(r2.hubInstalled).toBe(false);
    expect(native.calls).toHaveLength(2);
  });

  it('passes the default intent action', async () => {
    const native = nativeMock({ hubInstalled: false });
    await check({ nativeModule: native, cache });
    expect(native.calls[0]).toBe(DEFAULT_INTENT_ACTION);
  });

  it('respects a caller-supplied intent action', async () => {
    const native = nativeMock({ hubInstalled: false });
    await check({ nativeModule: native, cache, intentAction: 'com.example.alt' });
    expect(native.calls[0]).toBe('com.example.alt');
  });
});

describe('check — Hub not installed', () => {
  it('returns hubInstalled=false; result is cached', async () => {
    const cache = createDiscoveryCache();
    const native = nativeMock({ hubInstalled: false });
    const r1 = await check({ nativeModule: native, cache });
    expect(r1.hubInstalled).toBe(false);
    expect(r1.hubVersion).toBeUndefined();
    await check({ nativeModule: native, cache });
    expect(native.calls).toHaveLength(1);   // cache hit
  });
});

describe('check — native bridge error', () => {
  it('treats native error as "not installed" + does NOT cache', async () => {
    const cache = createDiscoveryCache();
    const native = nativeMock(new Error('binder dropped'));
    const r1 = await check({ nativeModule: native, cache });
    expect(r1.hubInstalled).toBe(false);
    expect(r1.error).toContain('binder dropped');
    // Transient → should NOT be cached. Next call re-queries.
    expect(cache.getCached()).toBe(null);
  });
});
