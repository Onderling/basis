/**
 * bootAgentBundle × extension mappings (feedback-extension P2 mobile parity).
 * With a mappings store, an installed extension's op is verified against the base
 * catalog and merged in at boot; an unsafe (unknown-op) mapping is refused.
 */

import { describe, it, expect } from 'vitest';
import { bootAgentBundle } from '../src/core/agentBundle.js';
import { asyncStorageMappingsStore, MAPPINGS_DEVICE } from '../src/core/mappingsStoreRN.js';

// Write a mapping straight to the store (its own contract) — avoids a direct
// '@canopy/pod-routing/mappings' import (resolves from mobile's stale copy);
// production reaches the loader via canopy-chat's symlink.
const put = (store, mapping) =>
  store.write(`pseudo-pod://${MAPPINGS_DEVICE}/private/mappings/${mapping.id}`, mapping);

function fakeAsyncStorage() {
  const map = new Map();
  return {
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, String(v)); },
    removeItem: async (k) => { map.delete(k); },
    getAllKeys: async () => [...map.keys()],
  };
}
const stub = () => ({ replies: [], stateUpdates: [] });

describe('bootAgentBundle — extension mappings (mobile P2)', () => {
  it('merges an installed extension op into the catalog at boot', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    // pick a real base op to compose onto (whatever the mock catalog exposes)
    const base = await bootAgentBundle({ skillStub: stub });
    const someOp = [...base.catalog.opsById.keys()][0];
    const [appOrigin, opId] = someOp.includes('/') ? someOp.split('/') : ['household', someOp];

    await put(store, { id: 'ext-demo', scope: 'app',
      ops: [{ id: 'extOp', verb: 'submit', steps: [{ appOrigin, opId }] }] });

    const booted = await bootAgentBundle({ skillStub: stub, mappingsStore: store, mappingsDeviceId: MAPPINGS_DEVICE });
    expect(booted.catalog.opsById.has('extOp') || booted.catalog.opsById.has('ext-demo/extOp')).toBe(true);
  });

  it('refuses an unsafe mapping (unknown op) — not merged', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    await put(store, { id: 'bad',
      ops: [{ id: 'x', verb: 'submit', steps: [{ appOrigin: 'ghost', opId: 'nope' }] }] });

    const booted = await bootAgentBundle({ skillStub: stub, mappingsStore: store, mappingsDeviceId: MAPPINGS_DEVICE });
    expect(booted.catalog.opsById.has('x') || booted.catalog.opsById.has('bad/x')).toBe(false);
  });
});
