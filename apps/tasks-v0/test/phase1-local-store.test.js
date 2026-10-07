/**
 * Phase 1 smoke tests — wiring `@onderling/local-store` into Tasks V1.
 *
 * Three things to prove:
 *   1. `buildBundle()` returns a working CachingDataSource that the
 *      ItemStore can use as its DataSource.
 *   2. `createTasksAgent({localStoreBundle, ...})` works end-to-end —
 *      the V1 zero-config local-only path.
 *   3. The V0 zero-config path (`MemorySource` default) still works
 *      unchanged — backwards compat.
 *
 * Settings round-trip is covered separately in
 * `test/phase1-settings.test.js`.
 */

import { describe, it, expect } from 'vitest';

import { createTasksAgent } from '../src/Agent.js';
import { buildBundle }      from '../src/storage/buildBundle.js';

const TEST_ROLES = {
  'https://id.example/anne':  'admin',
  'https://id.example/bob':   'member',
};
const TEST_MEMBERS = [
  { webid: 'https://id.example/anne', displayName: 'Anne', role: 'admin' },
  { webid: 'https://id.example/bob',  displayName: 'Bob',  role: 'member' },
];

describe('Phase 1 — local-store wiring', () => {
  it('buildBundle returns a usable cache by default', () => {
    const bundle = buildBundle();
    expect(bundle.cache).toBeDefined();
    expect(typeof bundle.cache.read).toBe('function');
    expect(typeof bundle.cache.write).toBe('function');
  });

  it('buildBundle.attachInner refuses non-DataSource arguments', async () => {
    const bundle = buildBundle();
    await expect(bundle.attachInner({})).rejects.toThrow(/inner DataSource required/);
    await expect(bundle.attachInner(null)).rejects.toThrow(/inner DataSource required/);
  });

  it('buildBundle keeps writes in local cache before any inner is attached', async () => {
    const bundle = buildBundle();
    await bundle.cache.write('mem://tasks/items/x.json', { id: 'x', text: 'hello' });
    const got = await bundle.cache.read('mem://tasks/items/x.json');
    expect(got).toEqual({ id: 'x', text: 'hello' });
  });

  it('createTasksAgent accepts a localStoreBundle and uses its cache as the ItemStore DataSource', async () => {
    const bundle = buildBundle();

    const result = await createTasksAgent({
      roles:            TEST_ROLES,
      members:          TEST_MEMBERS,
      localStoreBundle: bundle,
    });

    expect(result.localStore).toBe(bundle);
    expect(result.itemStore).toBeDefined();

    // Add a task directly via the ItemStore (the wired DataSource) and verify
    // it lands in the bundle's cache.
    await result.itemStore.addItems([{
      type: 'task',
      text: 'Take out the trash',
    }], { actor: 'https://id.example/anne' });

    const open = await result.itemStore.listOpen();
    expect(open).toHaveLength(1);
    expect(open[0].text).toBe('Take out the trash');

    // Direct cache list proves the bundle's CachingDataSource is what
    // backs the ItemStore — keys exist under the items/ subtree.
    const keys = await bundle.cache.list('mem://tasks/items/');
    expect(keys.length).toBeGreaterThan(0);
    const fromCache = await bundle.cache.read(keys[0]);
    expect(fromCache).toBeTruthy();
    // The DataSource returns the same JSON shape ItemStore wrote — handle
    // both raw-object and JSON-string shapes (Stoop writes objects).
    const parsed = typeof fromCache === 'string' ? JSON.parse(fromCache) : fromCache;
    expect(parsed.text).toBe('Take out the trash');
  });

  it('createTasksAgent rejects passing both itemBackend and localStoreBundle', async () => {
    const bundle = buildBundle();
    await expect(createTasksAgent({
      roles:            TEST_ROLES,
      members:          TEST_MEMBERS,
      itemBackend:      {},
      localStoreBundle: bundle,
    })).rejects.toThrow(/either `itemBackend` or `localStoreBundle`/);
  });

  it('V0 zero-config path (no localStoreBundle, no itemBackend) still works — defaults to MemorySource', async () => {
    const result = await createTasksAgent({
      roles:   TEST_ROLES,
      members: TEST_MEMBERS,
    });
    expect(result.localStore).toBeNull();
    expect(result.itemStore).toBeDefined();
  });
});
