/**
 * P2c end-to-end — the full extension pipeline with the REAL pod-routing loader:
 * localStorage store → writeMapping (install) → loadMappings (boot scan) →
 * verifyMappings (sandbox gate) → mappingsToSources → mergeManifests. Proves an
 * installed extension reaches the dispatch catalog, and an unsafe one is refused.
 */

import { describe, it, expect } from 'vitest';
import { writeMapping, loadMappings } from '@canopy/pod-routing/mappings';
import { localStorageMappingsStore, WEB_MAPPINGS_DEVICE } from '../src/v2/mappingsStore.js';
import { verifyMappings, mappingsToSources } from '../src/mappings.js';
import { mergeManifests } from '../src/manifestMerge.js';

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

const base = () => [{
  manifest: { app: 'household', itemTypes: [], operations: [{ id: 'addItem', verb: 'add' }] },
}];

describe('P2c pipeline (localStorage → loadMappings → verify → merge)', () => {
  it('an installed extension mapping reaches the dispatch catalog', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    const deviceId = WEB_MAPPINGS_DEVICE;

    await writeMapping({ pseudoPod: store, deviceId, mapping: {
      id: 'feedback-buurtplan', scope: 'app',
      ops: [{ id: 'feedback', verb: 'submit', steps: [{ appOrigin: 'household', opId: 'addItem' }] }],
    } });

    const baseCatalog = mergeManifests(base());
    const { mappings } = await loadMappings({ pseudoPod: store, deviceId });
    const { accepted, rejected } = verifyMappings(mappings, baseCatalog);
    const { sources, dropped } = mappingsToSources(accepted);
    const full = mergeManifests([...base(), ...sources]);

    expect(rejected).toEqual([]);
    expect(dropped).toEqual([]);
    expect(full.opsById.has('feedback') || full.opsById.has('feedback-buurtplan/feedback')).toBe(true);
  });

  it('a mapping referencing an unknown op is refused (never merged)', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    await writeMapping({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE, mapping: {
      id: 'bad', ops: [{ id: 'x', verb: 'submit', steps: [{ appOrigin: 'ghost', opId: 'nope' }] }],
    } });

    const { mappings } = await loadMappings({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE });
    const { accepted, rejected } = verifyMappings(mappings, mergeManifests(base()));
    expect(accepted).toEqual([]);
    expect(rejected[0].missing).toEqual(['ghost/nope']);
  });
});
