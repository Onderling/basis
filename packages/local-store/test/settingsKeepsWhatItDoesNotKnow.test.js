/**
 * SAVING SETTINGS NEVER DROPS A FIELD THIS BUILD DOES NOT KNOW, AND NEVER WRITES OVER A FILE IT COULD NOT READ.
 *
 * `saveSettings` wrote only the fields in this build's defaults: a field a newer build had added (or one this build
 * no longer lists) was dropped at the first save. And a settings file that did not parse read as "no settings" and
 * the next save wrote the defaults over it. Now a save keeps every field it does not know, as it found it, and a file
 * that does not parse is left alone (a save to it is refused) while the defaults are used in memory.
 */
import { describe, it, expect } from 'vitest';
import { createSettingsModule } from '../index.js';

function memoryDataSource(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    m,
    async read(p) { return m.has(p) ? m.get(p) : null; },
    async write(p, v) { m.set(p, v); },
    async delete(p) { m.delete(p); },
  };
}

const mod = () => createSettingsModule({
  appId: 'tst',
  sharedFields: ['theme'],
  deviceFields: ['volume'],
  defaults: { theme: 'light', volume: 5 },
});

describe('settings keep what this build does not know', () => {
  it('a field a newer build added survives a save of the fields this build knows', async () => {
    const s = mod();
    const ds = memoryDataSource({
      [s.SETTINGS_SHARED_PATH]: JSON.stringify({ theme: 'dark', fontScale: 1.4 }),
      [s.SETTINGS_MIGRATION_MARKER]: JSON.stringify({ done: true }),
    });
    await s.updateSettings({ dataSource: ds, deviceId: 'd1', patch: { theme: 'light' } });
    expect(JSON.parse(ds.m.get(s.SETTINGS_SHARED_PATH))).toEqual({ theme: 'light', fontScale: 1.4 });
  });

  it('the same for the device file and a scoped save', async () => {
    const s = mod();
    const dev = `${s.SETTINGS_DEVICE_PATH_PREFIX}d1.json`;
    const ds = memoryDataSource({ [dev]: JSON.stringify({ volume: 2, haptics: true }), [s.SETTINGS_MIGRATION_MARKER]: JSON.stringify({ done: true }) });
    await s.updateSettings({ dataSource: ds, deviceId: 'd1', patch: { volume: 9 }, scope: 'device' });
    expect(JSON.parse(ds.m.get(dev))).toEqual({ volume: 9, haptics: true });
  });

  it('a settings file that does not parse is not written over; the defaults are used meanwhile', async () => {
    const s = mod();
    const torn = '{"theme": "da';
    const ds = memoryDataSource({ [s.SETTINGS_SHARED_PATH]: torn, [s.SETTINGS_MIGRATION_MARKER]: JSON.stringify({ done: true }) });
    expect((await s.loadSettings({ dataSource: ds, deviceId: 'd1' })).theme).toBe('light');
    await s.updateSettings({ dataSource: ds, deviceId: 'd1', patch: { theme: 'dark', volume: 7 } });
    expect(ds.m.get(s.SETTINGS_SHARED_PATH)).toBe(torn);
    expect(JSON.parse(ds.m.get(`${s.SETTINGS_DEVICE_PATH_PREFIX}d1.json`))).toEqual({ volume: 7 });   // the readable one is saved
  });

  it('a field this build knows but that belongs in the other file is not carried along as unknown', async () => {
    const s = mod();
    const ds = memoryDataSource({
      [s.SETTINGS_SHARED_PATH]: JSON.stringify({ theme: 'dark', volume: 3 }),
      [s.SETTINGS_MIGRATION_MARKER]: JSON.stringify({ done: true }),
    });
    await s.saveSettings({ dataSource: ds, deviceId: 'd1', settings: { theme: 'dark', volume: 3 } });
    expect(JSON.parse(ds.m.get(s.SETTINGS_SHARED_PATH))).toEqual({ theme: 'dark' });
  });
});
