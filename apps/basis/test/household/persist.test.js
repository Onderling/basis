/**
 * OBJ-2 S1e — persistence for the household store.
 *
 * Proves three things:
 *   A. InMemoryStore({ dataSource }) USES the injected dataSource — two
 *      stores sharing ONE CachingDataSource see each other's writes (so
 *      the dataSource, not a per-store Map, is the source of truth).
 *   B. buildHouseholdDataSource round-trips across "reloads" for a Node
 *      {path} descriptor — a fresh store over the same on-disk file sees
 *      the earlier write.
 *   C. buildHouseholdDataSource(null/undefined) returns falsy so the
 *      caller falls back to the in-memory default.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemoryStore } from '../../src/household/InMemoryStore.js';
import { buildHouseholdDataSource } from '../../src/household/persist.js';

const tempDirs = [];
async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'household-persist-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(async () => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

describe('OBJ-2 S1e — household store persistence', () => {
  it('A — two stores sharing one injected dataSource see each other\'s writes', async () => {
    // One persistent CachingDataSource over a shared on-disk backend,
    // injected into TWO InMemoryStores.  A write via store1 must be
    // visible via store2 — proving the dataSource is the truth.
    const dir        = await tempDir();
    const path       = join(dir, 'state.json');
    const dataSource = await buildHouseholdDataSource({ path });
    expect(dataSource).toBeTruthy();

    const store1 = new InMemoryStore({ dataSource });
    const store2 = new InMemoryStore({ dataSource });

    await store1.addItem({ type: 'shopping', text: 'SharedMilk' });

    const seen = await store2.listOpen();
    expect(seen.map((it) => it.text)).toContain('SharedMilk');
  });

  it('B — buildHouseholdDataSource({path}) round-trips across a fresh store', async () => {
    const dir  = await tempDir();
    const path = join(dir, 'state.json');

    // First store — write + let the debounced save flush to disk.
    const ds1    = await buildHouseholdDataSource({ path });
    const store1 = new InMemoryStore({ dataSource: ds1 });
    await store1.addItem({ type: 'task', text: 'PersistMe' });
    // Default debounce is 200ms; wait past it so the snapshot lands.
    await new Promise((r) => setTimeout(r, 350));

    // SECOND source over the SAME path + a fresh store — must re-load
    // the prior snapshot.
    const ds2    = await buildHouseholdDataSource({ path });
    const store2 = new InMemoryStore({ dataSource: ds2 });

    const items = await store2.listOpen();
    expect(items.map((it) => it.text)).toContain('PersistMe');
  });

  it('C — buildHouseholdDataSource(null/undefined) returns falsy', async () => {
    expect(await buildHouseholdDataSource(undefined)).toBeFalsy();
    expect(await buildHouseholdDataSource(null)).toBeFalsy();
    expect(await buildHouseholdDataSource({})).toBeFalsy(); // no path/dbName
  });
});
