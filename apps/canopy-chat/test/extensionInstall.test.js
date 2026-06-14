/**
 * extensionInstall (P2c-3) — the plain consent-card model + install/uninstall.
 * buildConsentModel refuses an unsafe mapping and otherwise enumerates exactly
 * what it can do; install writes (after re-checking the gate), uninstall removes.
 */

import { describe, it, expect } from 'vitest';
import { loadMappings } from '@canopy/pod-routing/mappings';
import { buildConsentModel, installMapping, uninstallMapping } from '../src/v2/extensionInstall.js';
import { localStorageMappingsStore, WEB_MAPPINGS_DEVICE } from '../src/v2/mappingsStore.js';

const catalog = {
  opsById: new Map([
    ['addItem', { op: {}, appOrigin: 'household' }],
    ['household/addItem', { op: {}, appOrigin: 'household' }],
  ]),
};

const mapping = (overrides = {}) => ({
  id: 'feedback-buurtplan',
  title: 'Buurtplan feedback',
  scope: 'circle',
  needs: ['call-LLM', 'write-pod'],
  ops: [{
    id: 'feedback', verb: 'submit',
    surfaces: { slash: { command: '/feedback' } },
    steps: [{ appOrigin: 'household', opId: 'addItem' }],
  }],
  ...overrides,
});

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

describe('buildConsentModel', () => {
  it('builds a plain card enumerating commands, what they invoke, needs + scope', () => {
    const { ok, card } = buildConsentModel(mapping(), catalog);
    expect(ok).toBe(true);
    expect(card.title).toBe('Buurtplan feedback');
    expect(card.scope).toBe('circle');
    expect(card.needs).toEqual(['call-LLM', 'write-pod']);
    expect(card.commands).toEqual([{ command: '/feedback', invokes: ['household/addItem'] }]);
    expect(card.whatIfDeny).toMatch(/Nothing is added/);
  });

  it('refuses a mapping referencing an unknown op (no card, missing listed)', () => {
    const bad = mapping({ ops: [{ id: 'x', verb: 'submit', steps: [{ appOrigin: 'ghost', opId: 'nope' }] }] });
    const res = buildConsentModel(bad, catalog);
    expect(res.ok).toBe(false);
    expect(res.card).toBeNull();
    expect(res.missing).toEqual(['ghost/nope']);
  });
});

describe('installMapping / uninstallMapping', () => {
  it('install writes a safe mapping; load then finds it', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    const res = await installMapping({ store, deviceId: WEB_MAPPINGS_DEVICE, mapping: mapping(), catalog });
    expect(res.ok).toBe(true);
    const { mappings } = await loadMappings({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE });
    expect(mappings.map((m) => m.id)).toEqual(['feedback-buurtplan']);
  });

  it('install refuses an unsafe mapping and writes nothing', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    const bad = mapping({ id: 'bad', ops: [{ id: 'x', verb: 'submit', steps: [{ appOrigin: 'ghost', opId: 'nope' }] }] });
    const res = await installMapping({ store, deviceId: WEB_MAPPINGS_DEVICE, mapping: bad, catalog });
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['ghost/nope']);
    const { mappings } = await loadMappings({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE });
    expect(mappings).toEqual([]);
  });

  it('uninstall removes it', async () => {
    const store = localStorageMappingsStore(fakeStorage());
    await installMapping({ store, deviceId: WEB_MAPPINGS_DEVICE, mapping: mapping(), catalog });
    await uninstallMapping({ store, deviceId: WEB_MAPPINGS_DEVICE, id: 'feedback-buurtplan' });
    const { mappings } = await loadMappings({ pseudoPod: store, deviceId: WEB_MAPPINGS_DEVICE });
    expect(mappings).toEqual([]);
  });
});
