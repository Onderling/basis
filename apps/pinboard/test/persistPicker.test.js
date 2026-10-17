/**
 * persistPicker — adapter-selection tests.
 *
 * Verifies:
 *   - {path} picks FilePersist (Node)
 *   - {dbName} picks IndexedDBPersist (browser; via fake-indexeddb)
 *   - passing both is rejected (mutually exclusive intent)
 *   - passing neither returns null (caller wants in-memory)
 *   - saveDelayMs flows through to both adapters
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { pickPersist } from '../src/lib/persistPicker.js';

function freshTmpFile() {
  return join(tmpdir(), `pinboard-picker-${Date.now()}-${Math.random().toString(36).slice(2,6)}.json`);
}

describe('persistPicker', () => {
  it('returns null when neither path nor dbName is set', async () => {
    expect(await pickPersist({})).toBeNull();
    expect(await pickPersist()).toBeNull();
  });

  it('picks FilePersist when only {path} is set', async () => {
    const picked = await pickPersist({ path: freshTmpFile() });
    expect(picked.kind).toBe('file');
    expect(picked.persist.constructor.name).toBe('FilePersist');
  });

  it('picks IndexedDBPersist when only {dbName} is set', async () => {
    const picked = await pickPersist({ dbName: 'pinboard-picker-test' });
    expect(picked.kind).toBe('idb');
    expect(picked.persist.constructor.name).toBe('IndexedDBPersist');
  });

  it('rejects passing both path AND dbName', async () => {
    await expect(pickPersist({ path: '/tmp/x.json', dbName: 'x' }))
      .rejects.toThrow(/EITHER .* OR/);
  });

  it('passes saveDelayMs through to FilePersist', async () => {
    // No public getter for the delay; smoke-check that construction
    // succeeds with the opt set.
    const picked = await pickPersist({ path: freshTmpFile(), saveDelayMs: 1234 });
    expect(picked.persist).toBeTruthy();
  });

  it('passes saveDelayMs + storeName through to IndexedDBPersist', async () => {
    const picked = await pickPersist({
      dbName: 'pinboard-picker-test-2',
      storeName: 'custom-store',
      saveDelayMs: 500,
    });
    expect(picked.persist).toBeTruthy();
  });

  // ── — AsyncStoragePersist branch ───────────────────────────

  function makeMockAsyncStorage() {
    const store = new Map();
    return {
      _store: store,
      async getItem(k)    { return store.has(k) ? store.get(k) : null; },
      async setItem(k, v) { store.set(k, String(v)); },
      async removeItem(k) { store.delete(k); },
    };
  }

  it('{asyncStorage, dbName} picks AsyncStoragePersist (RN)', async () => {
    const picked = await pickPersist({
      asyncStorage: makeMockAsyncStorage(),
      dbName:       'cc-pinboard-cache',
    });
    expect(picked.kind).toBe('async');
    expect(picked.persist.constructor.name).toBe('AsyncStoragePersist');
  });

  it('rejects {asyncStorage} without dbName (dbName is the key namespace)', async () => {
    await expect(pickPersist({ asyncStorage: makeMockAsyncStorage() }))
      .rejects.toThrow(/dbName/);
  });

  it('rejects path + asyncStorage combo', async () => {
    await expect(pickPersist({
      path:         '/tmp/x.json',
      asyncStorage: makeMockAsyncStorage(),
      dbName:       'x',
    })).rejects.toThrow(/not a combination/);
  });
});
