/**
 * VaultAsyncStorage — unit tests.
 *
 * Uses a mock AsyncStorage so vitest can verify the Vault contract
 * without an actual RN runtime.  Mirrors the round-trip + isolation
 * coverage that VaultMemory + VaultLocalStorage rely on in
 * @onderling/vault.
 *
 * Task (2026-05-24).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { VaultAsyncStorage } from '../../src/identity/VaultAsyncStorage.js';

/**
 * Tiny in-memory AsyncStorage compatible with the surface
 * VaultAsyncStorage consumes (getItem / setItem / removeItem /
 * getAllKeys).  Same contract real @react-native-async-storage/
 * async-storage exposes.
 */
function makeMockAsyncStorage() {
  const store = new Map();
  return {
    _store: store,
    async getItem(k)    { return store.has(k) ? store.get(k) : null; },
    async setItem(k, v) { store.set(k, String(v)); },
    async removeItem(k) { store.delete(k); },
    async getAllKeys()  { return [...store.keys()]; },
  };
}

describe('VaultAsyncStorage — round-trip', () => {
  let storage; let vault;
  beforeEach(() => {
    storage = makeMockAsyncStorage();
    vault   = new VaultAsyncStorage({ asyncStorage: storage });
  });

  it('set + get round-trips a string', async () => {
    await vault.set('agent-privkey', 'abc123');
    expect(await vault.get('agent-privkey')).toBe('abc123');
  });

  it('returns null for unknown keys', async () => {
    expect(await vault.get('does-not-exist')).toBe(null);
  });

  it('delete removes the value', async () => {
    await vault.set('temp', 'x');
    expect(await vault.has('temp')).toBe(true);
    await vault.delete('temp');
    expect(await vault.has('temp')).toBe(false);
    expect(await vault.get('temp')).toBe(null);
  });

  it('has returns true only for set keys', async () => {
    await vault.set('a', '1');
    expect(await vault.has('a')).toBe(true);
    expect(await vault.has('b')).toBe(false);
  });

  it('list returns un-prefixed keys', async () => {
    await vault.set('one', '1');
    await vault.set('two', '2');
    await vault.set('three', '3');
    const keys = (await vault.list()).sort();
    expect(keys).toEqual(['one', 'three', 'two']);
  });

  it('coerces non-string values via String()', async () => {
    await vault.set('num', 42);
    expect(await vault.get('num')).toBe('42');
    await vault.set('bool', true);
    expect(await vault.get('bool')).toBe('true');
  });
});

describe('VaultAsyncStorage — prefix isolation', () => {
  it('two vaults with different prefixes do not see each other', async () => {
    const storage = makeMockAsyncStorage();
    const v1 = new VaultAsyncStorage({ prefix: 'basis.chat-id:', asyncStorage: storage });
    const v2 = new VaultAsyncStorage({ prefix: 'basis.host-id:', asyncStorage: storage });

    await v1.set('agent-privkey', 'chat-secret');
    await v2.set('agent-privkey', 'host-secret');

    expect(await v1.get('agent-privkey')).toBe('chat-secret');
    expect(await v2.get('agent-privkey')).toBe('host-secret');

    expect((await v1.list()).sort()).toEqual(['agent-privkey']);
    expect((await v2.list()).sort()).toEqual(['agent-privkey']);
  });

  it('list does not leak keys from outside the prefix', async () => {
    const storage = makeMockAsyncStorage();
    // Pre-populate with a foreign key (e.g. AsyncStorageAdapter's data).
    await storage.setItem('dwag-other:somekey', 'foreign');
    const vault = new VaultAsyncStorage({ prefix: 'mine:', asyncStorage: storage });
    await vault.set('a', 'b');
    const keys = await vault.list();
    expect(keys).toEqual(['a']);   // not ['a', 'dwag-other:somekey']
  });
});

describe('VaultAsyncStorage — defaults', () => {
  it('throws a clear error when no AsyncStorage available', () => {
    expect(() => new VaultAsyncStorage({ asyncStorage: {} }))
      .toThrow(/requires @react-native-async-storage|getItem/i);
  });

  it('default prefix is "dwag:" (matches VaultLocalStorage)', async () => {
    const storage = makeMockAsyncStorage();
    const vault   = new VaultAsyncStorage({ asyncStorage: storage });
    await vault.set('k', 'v');
    expect(storage._store.has('dwag:k')).toBe(true);
  });
});
