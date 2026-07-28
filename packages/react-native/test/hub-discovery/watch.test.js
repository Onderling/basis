/**
 * hub-discovery.watch — package-event subscription + cache invalidation.
 */

import { describe, it, expect } from 'vitest';
import { createDiscoveryCache } from '../../src/hub-discovery/cache.js';
import { watch } from '../../src/hub-discovery/watch.js';

function nativeMock() {
  const subscribers = new Set();
  return {
    subscribers,
    subscribePackageEvents(cb) {
      subscribers.add(cb);
      return () => { subscribers.delete(cb); };
    },
    /** Test-only — deliver an event into every subscriber. */
    emit(event) { for (const cb of subscribers) cb(event); },
  };
}

describe('watch — input validation', () => {
  it('rejects missing nativeModule', () => {
    expect(() => watch({ cache: createDiscoveryCache(), callback: () => {} }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('rejects missing callback', () => {
    expect(() => watch({
      nativeModule: nativeMock(),
      cache:        createDiscoveryCache(),
    })).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('watch — event delivery', () => {
  it('fires the callback on added events', () => {
    const native = nativeMock();
    const cache = createDiscoveryCache();
    const events = [];
    watch({ nativeModule: native, cache, callback: (e) => events.push(e) });

    native.emit({ op: 'added',   packageName: 'org.onderling.hub' });
    native.emit({ op: 'removed', packageName: 'org.onderling.hub' });

    expect(events.map(e => e.op)).toEqual(['added', 'removed']);
    expect(events[0].packageName).toBe('org.onderling.hub');
    expect(typeof events[0].at).toBe('string');
  });

  it('invalidates the discovery cache on every event', () => {
    const native = nativeMock();
    const cache = createDiscoveryCache();
    cache.setCached({ hubInstalled: true, hubVersion: 1 });
    watch({ nativeModule: native, cache, callback: () => {} });

    native.emit({ op: 'removed', packageName: 'org.onderling.hub' });
    expect(cache.getCached()).toBe(null);
  });

  it('unsubscribe stops further callbacks', () => {
    const native = nativeMock();
    const cache = createDiscoveryCache();
    const events = [];
    const unsub = watch({ nativeModule: native, cache, callback: (e) => events.push(e) });
    native.emit({ op: 'added', packageName: 'x' });
    unsub();
    native.emit({ op: 'added', packageName: 'y' });
    expect(events).toHaveLength(1);
  });

  it('callback errors are swallowed', () => {
    const native = nativeMock();
    const cache = createDiscoveryCache();
    watch({
      nativeModule: native,
      cache,
      callback: () => { throw new Error('bang'); },
    });
    expect(() => native.emit({ op: 'added', packageName: 'x' })).not.toThrow();
  });

  it('normalises unknown ops to "unknown"', () => {
    const native = nativeMock();
    const cache = createDiscoveryCache();
    const events = [];
    watch({ nativeModule: native, cache, callback: (e) => events.push(e) });
    native.emit({ op: 'unknown-thing', packageName: 'x' });
    expect(events[0].op).toBe('unknown');
  });
});
