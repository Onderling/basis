/**
 * Substrate-side smoke for createSettingsModule.  Pinboard's existing
 * phase33 + phase34 tests in apps/pinboard/test exercise the
 * Pinboard-bound module end-to-end; this file verifies the factory's
 * own contract (path prefixing, schema partition, validator hook).
 */

import { describe, it, expect } from 'vitest';
import { createSettingsModule } from '../index.js';

function makeFakeCache() {
  const store = new Map();
  return {
    store,
    async read(p)        { return store.has(p) ? store.get(p) : null; },
    async write(p, data) { store.set(p, data); },
    async delete(p)      { store.delete(p); },
    async list()         { return Array.from(store.keys()); },
  };
}

describe('createSettingsModule', () => {
  it('rejects bad appId', () => {
    expect(() => createSettingsModule({
      appId: 'has space', sharedFields: [], deviceFields: [], defaults: {},
    })).toThrow(/appId must match/);
    expect(() => createSettingsModule({
      appId: '', sharedFields: [], deviceFields: [], defaults: {},
    })).toThrow(/appId must match/);
  });

  it('paths are <appId>-prefixed', () => {
    const m = createSettingsModule({
      appId: 'demo', sharedFields: ['x'], deviceFields: ['y'], defaults: { x: 1, y: 2 },
    });
    expect(m.SETTINGS_SHARED_PATH).toBe('mem://demo/settings/shared.json');
    expect(m.SETTINGS_LEGACY_PATH).toBe('mem://demo/settings.json');
    expect(m.SETTINGS_MIGRATION_MARKER).toBe('mem://demo/settings/.migrated-from-v2');
    expect(m.SETTINGS_DEVICE_PATH_PREFIX).toBe('mem://demo/settings/devices/');
  });

  it('partitions writes by field schema', async () => {
    const m = createSettingsModule({
      appId: 'demo',
      sharedFields: ['a'],
      deviceFields: ['b'],
      defaults:     { a: 'A', b: 'B' },
    });
    const cache = makeFakeCache();
    await m.saveSettings({
      dataSource: cache, deviceId: 'dev-1',
      settings:   { a: 'sharedVal', b: 'deviceVal' },
    });
    const sharedBlob = JSON.parse(cache.store.get('mem://demo/settings/shared.json'));
    const deviceBlob = JSON.parse(cache.store.get('mem://demo/settings/devices/dev-1.json'));
    expect(sharedBlob).toEqual({ a: 'sharedVal' });
    expect(deviceBlob).toEqual({ b: 'deviceVal' });
  });

  it('loadSettings merges shared + device with device winning', async () => {
    const m = createSettingsModule({
      appId: 'demo',
      sharedFields: ['a'],
      deviceFields: ['b'],
      defaults:     { a: 'A', b: 'B' },
    });
    const cache = makeFakeCache();
    cache.store.set('mem://demo/settings/shared.json',           JSON.stringify({ a: 'sharedA' }));
    cache.store.set('mem://demo/settings/devices/dev-1.json',    JSON.stringify({ b: 'deviceB' }));
    const out = await m.loadSettings({ dataSource: cache, deviceId: 'dev-1' });
    expect(out).toEqual({ a: 'sharedA', b: 'deviceB' });
  });

  it('cold-boot returns DEFAULT_SETTINGS', async () => {
    const m = createSettingsModule({
      appId: 'demo',
      sharedFields: ['a'],
      deviceFields: ['b'],
      defaults:     { a: 'A', b: 'B' },
    });
    const cache = makeFakeCache();
    expect(await m.loadSettings({ dataSource: cache, deviceId: 'dev-1' }))
      .toEqual({ a: 'A', b: 'B' });
  });

  it('honours custom fieldValidator', async () => {
    const m = createSettingsModule({
      appId: 'demo',
      sharedFields: ['n'],
      deviceFields: [],
      defaults:     { n: 0 },
      fieldValidator: (value, _name, def) =>
        typeof value === 'number' && value >= 5 ? value : def,
    });
    const cache = makeFakeCache();
    await m.saveSettings({ dataSource: cache, deviceId: 'd', settings: { n: 3 } });
    const r1 = await m.loadSettings({ dataSource: cache, deviceId: 'd' });
    expect(r1.n).toBe(0);
    await m.saveSettings({ dataSource: cache, deviceId: 'd', settings: { n: 7 } });
    const r2 = await m.loadSettings({ dataSource: cache, deviceId: 'd' });
    expect(r2.n).toBe(7);
  });

  it('legacy migration: reads mem://<app>/settings.json once and partitions', async () => {
    const m = createSettingsModule({
      appId: 'demo',
      sharedFields: ['a'],
      deviceFields: ['b'],
      defaults:     { a: 'A', b: 'B' },
    });
    const cache = makeFakeCache();
    cache.store.set('mem://demo/settings.json', JSON.stringify({ a: 'sharedA', b: 'deviceB' }));

    const out = await m.loadSettings({ dataSource: cache, deviceId: 'dev-1' });
    expect(out).toEqual({ a: 'sharedA', b: 'deviceB' });
    // After load: legacy gone, shared + device written, marker set.
    expect(cache.store.has('mem://demo/settings.json')).toBe(false);
    expect(cache.store.has('mem://demo/settings/shared.json')).toBe(true);
    expect(cache.store.has('mem://demo/settings/devices/dev-1.json')).toBe(true);
    expect(cache.store.has('mem://demo/settings/.migrated-from-v2')).toBe(true);
  });
});
