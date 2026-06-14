/**
 * loadVerifyMappings (P2 shared core) — load the store → verify against the
 * catalog → return mergeable sources for accepted, rejected for the rest.
 */

import { describe, it, expect } from 'vitest';
import { writeMapping } from '@canopy/pod-routing/mappings';
import { loadVerifyMappings } from '../src/v2/mappingsLoader.js';
import { localStorageMappingsStore, WEB_MAPPINGS_DEVICE } from '../src/v2/mappingsStore.js';

function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    key: (i) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
}

const catalog = { opsById: new Map([['household/addItem', { op: {}, appOrigin: 'household' }]]) };

describe('loadVerifyMappings', () => {
  it('returns sources for an accepted mapping + its origin', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    await writeMapping({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE, mapping: {
      id: 'fb', scope: 'app',
      ops: [{ id: 'feedback', verb: 'submit', steps: [{ appOrigin: 'household', opId: 'addItem' }] }],
    } });
    const r = await loadVerifyMappings({ store, deviceId: WEB_MAPPINGS_DEVICE, catalog });
    expect(r.sources.map((s) => s.manifest.app)).toEqual(['fb']);
    expect(r.mappingOrigins).toEqual(['fb']);
    expect(r.rejected).toEqual([]);
  });

  it('rejects a mapping with an unknown opId (no source)', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    await writeMapping({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE, mapping: {
      id: 'bad', ops: [{ id: 'x', verb: 'submit', steps: [{ appOrigin: 'ghost', opId: 'nope' }] }],
    } });
    const r = await loadVerifyMappings({ store, deviceId: WEB_MAPPINGS_DEVICE, catalog });
    expect(r.sources).toEqual([]);
    expect(r.rejected[0].missing).toEqual(['ghost/nope']);
  });

  it('empty store → no sources, no rejects', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    const r = await loadVerifyMappings({ store, deviceId: WEB_MAPPINGS_DEVICE, catalog });
    expect(r).toMatchObject({ sources: [], rejected: [], mappingOrigins: [] });
  });
});
