/**
 * Nothing the phone keeps lives only in memory. React Native has no `localStorage`, so every vault `realAgent` builds
 * for itself falls back to a memory vault there unless the phone hands it storage — the owner root did (fixed
 * 2026-07-30: the recovery phrase changed on every launch), and on 2026-10-23 eight more were found doing it, among
 * them four in-process agents' identities, which minted a fresh key on every start. This boots the real mobile bundle
 * over one AsyncStorage and asks realAgent which vaults fell to memory: none may.
 */
import { describe, it, expect } from 'vitest';
import { bootAgentBundle } from '../src/core/agentBundle.js';
import { memoryVaultFallbacks } from '../../basis/src/core/agent/realAgent.js';

function fakeAsyncStorage(store = new Map()) {
  return {
    store,
    getItem: async (k) => (store.has(k) ? store.get(k) : null),
    setItem: async (k, v) => { store.set(k, v); },
    removeItem: async (k) => { store.delete(k); },
    getAllKeys: async () => [...store.keys()],
    multiGet: async (ks) => ks.map((k) => [k, store.has(k) ? store.get(k) : null]),
    multiSet: async (kvs) => { for (const [k, v] of kvs) store.set(k, v); },
    multiRemove: async (ks) => { for (const k of ks) store.delete(k); },
  };
}

describe('the phone keeps every vault', () => {
  it('no realAgent vault falls back to memory, and the in-process agents keep their keys across a relaunch', { timeout: 120_000 }, async () => {
    const asyncStorage = fakeAsyncStorage();
    const before = memoryVaultFallbacks().length;
    const first = await bootAgentBundle({ asyncStorage });
    expect(memoryVaultFallbacks().slice(before)).toEqual([]);
    const agentSlots = () => Object.fromEntries([...asyncStorage.store.entries()].filter(([k]) => /^cc-(household-agent|tasks|pinboard|folio)-id:/.test(k)).sort());
    const keysFirst = agentSlots();
    try { await first.agent?.stop?.(); } catch { /* the process died */ }
    const second = await bootAgentBundle({ asyncStorage });
    const keysSecond = agentSlots();
    const prefixes = new Set(Object.keys(keysFirst).map((k) => k.split(':')[0]));
    expect([...prefixes].sort()).toEqual(['cc-folio-id', 'cc-household-agent-id', 'cc-pinboard-id', 'cc-tasks-id']);
    expect(keysSecond).toEqual(keysFirst);   // the same stored keys: restored, not minted again
    try { await second.agent?.stop?.(); } catch { /* */ }
  });
});
