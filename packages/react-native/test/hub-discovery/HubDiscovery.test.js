/**
 * createHubDiscovery — facade smoke tests.
 */

import { describe, it, expect } from 'vitest';
import { createHubDiscovery } from '../../src/hub-discovery/index.js';

function nativeMock(initial = { hubInstalled: false }) {
  const subs = new Set();
  let response = initial;
  return {
    setNextResponse(r) { response = r; },
    async queryHubService() { return response; },
    subscribePackageEvents(cb) {
      subs.add(cb);
      return () => { subs.delete(cb); };
    },
    emit(e) { for (const cb of subs) cb(e); },
  };
}

describe('createHubDiscovery', () => {
  it('rejects missing nativeModule', () => {
    expect(() => createHubDiscovery({})).toThrow(/nativeModule/);
  });

  it('check + invalidate + watch wired through the facade', async () => {
    const native = nativeMock({ hubInstalled: true, hubVersion: 1 });
    const hd = createHubDiscovery({ nativeModule: native });

    const r1 = await hd.check();
    expect(r1.hubInstalled).toBe(true);

    // Mid-session install/uninstall fires a cache invalidation + callback.
    const seen = [];
    hd.watch((event) => seen.push(event.op));
    native.setNextResponse({ hubInstalled: false });
    native.emit({ op: 'removed', packageName: 'org.onderling.hub' });
    const r2 = await hd.check();
    expect(r2.hubInstalled).toBe(false);
    expect(seen).toEqual(['removed']);
  });

  it('explicit invalidate forces re-query', async () => {
    const native = nativeMock({ hubInstalled: true });
    const hd = createHubDiscovery({ nativeModule: native });
    await hd.check();
    native.setNextResponse({ hubInstalled: false });
    hd.invalidate();
    const r = await hd.check();
    expect(r.hubInstalled).toBe(false);
  });
});
