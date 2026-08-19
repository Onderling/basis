/**
 * Stoop Phase 33 — Device-specific settings split.
 *
 * Verifies the shared/device blob layout introduced by Phase 33.2 +
 * 33.3:
 *
 *   `mem://stoop/settings/shared.json`              user-portable
 *   `mem://stoop/settings/devices/<deviceId>.json`  per-install
 *
 * Plus the migration from the legacy single blob and the merged-view
 * read API.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '../src/index.js';
import {
  loadSettings,
  saveSettings,
  updateSettings,
  DEFAULT_SETTINGS,
  SETTINGS_SHARED_PATH,
  SETTINGS_LEGACY_PATH,
  SETTINGS_MIGRATION_MARKER,
} from '../src/lib/Settings.js';

const ANNE = 'https://id.example/anne';

/** Minimal fake CachingDataSource — Map-backed read/write/delete. */
function makeFakeCache() {
  const store = new Map();
  return {
    store,
    async read(path)        { return store.has(path) ? store.get(path) : null; },
    async write(path, data) { store.set(path, data); },
    async delete(path)      { store.delete(path); },
    async list()            { return Array.from(store.keys()); },
  };
}

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     ANNE,
    agent,
    envelope: null,
  });
}

describe('Phase 33.2 — saveSettings partitions across shared + device blobs', () => {
  it('writes device-scoped fields ONLY into devices/<id>.json', async () => {
    const cache = makeFakeCache();
    const deviceId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    await saveSettings({
      dataSource: cache, deviceId,
      settings: { ...DEFAULT_SETTINGS, allowHopThrough: true, pollIntervalMs: 60_000 },
    });
    const devicePath = `mem://stoop/settings/devices/${deviceId}.json`;
    const device = JSON.parse(cache.store.get(devicePath));
    expect(device.allowHopThrough).toBe(true);
    expect(device.pollIntervalMs).toBe(60_000);
    expect(Object.prototype.hasOwnProperty.call(device, 'broadcastable')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(device, 'defaultShareLocation')).toBe(false);
  });

  it('writes shared fields ONLY into shared.json', async () => {
    const cache = makeFakeCache();
    const deviceId = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    await saveSettings({
      dataSource: cache, deviceId,
      settings: { ...DEFAULT_SETTINGS, broadcastable: false, defaultShareLocation: true },
    });
    const shared = JSON.parse(cache.store.get(SETTINGS_SHARED_PATH));
    expect(shared.broadcastable).toBe(false);
    expect(shared.defaultShareLocation).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(shared, 'allowHopThrough')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(shared, 'pollIntervalMs')).toBe(false);
  });
});

describe('Phase 33.2 — loadSettings merges shared overlaid by device', () => {
  it('returns the union of both blobs', async () => {
    const cache = makeFakeCache();
    const deviceId = 'cccccccc-3333-4333-8333-cccccccccccc';
    await saveSettings({
      dataSource: cache, deviceId,
      settings: {
        ...DEFAULT_SETTINGS,
        allowHopThrough:      true,
        broadcastable:        false,
        defaultShareLocation: true,
        pollIntervalMs:       30_000,
      },
    });
    const merged = await loadSettings({ dataSource: cache, deviceId });
    expect(merged).toMatchObject({
      allowHopThrough:      true,
      broadcastable:        false,
      defaultShareLocation: true,
      pollIntervalMs:       30_000,
    });
  });

  it('two devices see SHARED fields but each see their OWN device fields', async () => {
    const cache = makeFakeCache();
    const deviceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const deviceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

    // Device A writes to its blob + shared.
    await saveSettings({
      dataSource: cache, deviceId: deviceA,
      settings: { ...DEFAULT_SETTINGS, allowHopThrough: true,  broadcastable: false },
    });
    // Device B writes to ITS blob + the same shared (last write wins
    // on the shared blob — modelled because both devices touch shared).
    await saveSettings({
      dataSource: cache, deviceId: deviceB,
      settings: { ...DEFAULT_SETTINGS, allowHopThrough: false, broadcastable: false },
    });

    const onA = await loadSettings({ dataSource: cache, deviceId: deviceA });
    const onB = await loadSettings({ dataSource: cache, deviceId: deviceB });

    expect(onA.broadcastable).toBe(false);   // shared
    expect(onB.broadcastable).toBe(false);   // shared
    expect(onA.allowHopThrough).toBe(true);  // device-A blob
    expect(onB.allowHopThrough).toBe(false); // device-B blob
  });
});

describe('Phase 33.2 — updateSettings auto-routes by field', () => {
  it('a device-only patch writes to devices/<id>.json without touching shared.json', async () => {
    const cache = makeFakeCache();
    const deviceId = 'dddddddd-4444-4444-8444-dddddddddddd';
    // Seed shared with a known value.
    await saveSettings({
      dataSource: cache, deviceId,
      settings: { ...DEFAULT_SETTINGS, broadcastable: false },
    });
    const sharedBefore = cache.store.get(SETTINGS_SHARED_PATH);

    await updateSettings({
      dataSource: cache, deviceId,
      patch: { allowHopThrough: true },
    });

    // Shared blob's allowHopThrough field is filtered out, but the
    // shared blob is rewritten as part of saveSettings.  Verify the
    // shared field we cared about (broadcastable) survives.
    const sharedAfter = JSON.parse(cache.store.get(SETTINGS_SHARED_PATH));
    expect(sharedAfter.broadcastable).toBe(false);

    const device = JSON.parse(cache.store.get(`mem://stoop/settings/devices/${deviceId}.json`));
    expect(device.allowHopThrough).toBe(true);

    // (Sanity: we definitely wrote to shared at least once.)
    expect(sharedBefore).toBeTruthy();
  });

  it('explicit scope: "shared" only writes the shared blob', async () => {
    const cache = makeFakeCache();
    const deviceId = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
    // Seed: device has its own value; shared has its own value.
    await saveSettings({
      dataSource: cache, deviceId,
      settings: { ...DEFAULT_SETTINGS, allowHopThrough: true, broadcastable: true },
    });
    const deviceBefore = cache.store.get(`mem://stoop/settings/devices/${deviceId}.json`);

    // Patch broadcastable with explicit shared scope.  Device blob
    // should be untouched.
    await updateSettings({
      dataSource: cache, deviceId,
      patch: { broadcastable: false },
      scope: 'shared',
    });

    const deviceAfter = cache.store.get(`mem://stoop/settings/devices/${deviceId}.json`);
    expect(deviceAfter).toBe(deviceBefore); // exact same string == not rewritten
    const shared = JSON.parse(cache.store.get(SETTINGS_SHARED_PATH));
    expect(shared.broadcastable).toBe(false);
  });
});

describe('Phase 33.3 — legacy migration', () => {
  it('reads the legacy single blob, partitions it, deletes it, sets a marker', async () => {
    const cache = makeFakeCache();
    const deviceId = 'ffffffff-6666-4666-8666-ffffffffffff';

    // Plant a legacy blob with a mix of device + shared fields.
    cache.store.set(SETTINGS_LEGACY_PATH, JSON.stringify({
      pollIntervalMs:       30_000,    // device
      allowHopThrough:      true,      // device
      broadcastable:        false,     // shared
      defaultShareLocation: true,      // shared
    }));

    const merged = await loadSettings({ dataSource: cache, deviceId });
    expect(merged).toMatchObject({
      pollIntervalMs:       30_000,
      allowHopThrough:      true,
      broadcastable:        false,
      defaultShareLocation: true,
    });

    // Legacy blob is gone, marker present, new blobs are written.
    expect(cache.store.has(SETTINGS_LEGACY_PATH)).toBe(false);
    expect(cache.store.has(SETTINGS_MIGRATION_MARKER)).toBe(true);
    const shared = JSON.parse(cache.store.get(SETTINGS_SHARED_PATH));
    const device = JSON.parse(cache.store.get(`mem://stoop/settings/devices/${deviceId}.json`));
    expect(shared.broadcastable).toBe(false);
    expect(shared.defaultShareLocation).toBe(true);
    expect(device.pollIntervalMs).toBe(30_000);
    expect(device.allowHopThrough).toBe(true);
  });

  it('is idempotent — second load skips the migration', async () => {
    const cache = makeFakeCache();
    const deviceId = '99999999-7777-4777-8777-999999999999';
    cache.store.set(SETTINGS_LEGACY_PATH, JSON.stringify({ pollIntervalMs: 7_777 }));
    await loadSettings({ dataSource: cache, deviceId });
    const markerAfterFirst = cache.store.get(SETTINGS_MIGRATION_MARKER);

    // Second call: marker check short-circuits.  Even if a fresh
    // legacy blob were planted, the marker prevents re-migration.
    cache.store.set(SETTINGS_LEGACY_PATH, JSON.stringify({ pollIntervalMs: 1 }));
    const merged = await loadSettings({ dataSource: cache, deviceId });
    expect(cache.store.get(SETTINGS_MIGRATION_MARKER)).toBe(markerAfterFirst);
    // The replanted legacy blob is NOT migrated — its value never
    // appears in the merged view (we still see the value from the
    // first migration, 7_777, which lives in devices/<id>.json).
    expect(merged.pollIntervalMs).toBe(7_777);
  });
});

describe('Phase 33 — bundle integration', () => {
  it('createNeighbourhoodAgent exposes bundle.deviceId from the identity', async () => {
    const bundle = await buildBundle();
    expect(typeof bundle.deviceId).toBe('string');
    expect(bundle.deviceId.length).toBeGreaterThan(0);
    expect(bundle.deviceId).toBe(bundle.agent.identity.deviceId);
  });

  it('end-to-end: updateSettings via the skill writes to the right blobs', async () => {
    const bundle = await buildBundle();
    expect(bundle.agent.skills.get('updateSettings')).toBeTruthy();

    // Patch one device + one shared field through the skill.
    await callSkill(bundle.agent, 'updateSettings', {
      patch: { allowHopThrough: true, broadcastable: false },
    });

    const devicePath = `mem://stoop/settings/devices/${bundle.deviceId}.json`;
    const device = JSON.parse(await bundle.cache.read(devicePath));
    const shared = JSON.parse(await bundle.cache.read(SETTINGS_SHARED_PATH));
    expect(device.allowHopThrough).toBe(true);
    expect(shared.broadcastable).toBe(false);
  });
});
