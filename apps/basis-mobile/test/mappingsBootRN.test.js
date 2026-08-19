/**
 * bootAgentBundle × extension mappings (feedback-extension mobile parity).
 * With a mappings store, an installed extension's op is verified against the base
 * catalogue and merged in at boot; an unsafe (unknown-op) mapping is refused.
 */

import { describe, it, expect } from 'vitest';
import { bootAgentBundle } from '../src/core/agentBundle.js';
import { asyncStorageMappingsStore, MAPPINGS_DEVICE } from '../src/core/mappingsStoreRN.js';

// Write a mapping straight to the store (its own contract) — avoids a direct
// '@onderling/pod-routing/mappings' import (resolves from mobile's stale copy);
// production reaches the loader via basis's symlink.
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
  it('merges an installed extension op into the catalogue at boot', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    // pick a real base op to compose onto (whatever the mock catalogue exposes)
    const base = await bootAgentBundle({ skillStub: stub });
    const someOp = [...base.catalogue.opsById.keys()][0];
    const [appOrigin, opId] = someOp.includes('/') ? someOp.split('/') : ['household', someOp];

    await put(store, { id: 'ext-demo', scope: 'app',
      ops: [{ id: 'extOp', verb: 'submit', steps: [{ appOrigin, opId }] }] });

    const booted = await bootAgentBundle({ skillStub: stub, mappingsStore: store, mappingsDeviceId: MAPPINGS_DEVICE });
    expect(booted.catalogue.opsById.has('extOp') || booted.catalogue.opsById.has('ext-demo/extOp')).toBe(true);
  });

  it('refuses an unsafe mapping (unknown op) — not merged', async () => {
    const store = asyncStorageMappingsStore(fakeAsyncStorage());
    await put(store, { id: 'bad',
      ops: [{ id: 'x', verb: 'submit', steps: [{ appOrigin: 'ghost', opId: 'nope' }] }] });

    const booted = await bootAgentBundle({ skillStub: stub, mappingsStore: store, mappingsDeviceId: MAPPINGS_DEVICE });
    expect(booted.catalogue.opsById.has('x') || booted.catalogue.opsById.has('bad/x')).toBe(false);
  });
});
