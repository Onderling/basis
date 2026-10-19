/**
 * After a relaunch the phone's host agent still answers. Walked on an emulator 2026-10-09: fresh install → Start works
 * (`revealOwnerPhrase` handled in 0.3 s) → force-stop → relaunch → the same call is sent and NEVER handled (30 s
 * timeout), so creating a circle hung. This boots the real mobile bundle twice over one AsyncStorage — the relaunch —
 * and asks the host agent on the second boot.
 */
import { describe, it, expect } from 'vitest';
import { bootAgentBundle } from '../src/core/agentBundle.js';

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

const within = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`no answer in ${ms} ms`)), ms))]);

describe('the host agent across a relaunch', () => {
  it('answers on the second launch over the same storage', { timeout: 120_000 }, async () => {
    const asyncStorage = fakeAsyncStorage();
    const first = await bootAgentBundle({ asyncStorage });
    const p1 = await within(first.callSkill('household', 'revealOwnerPhrase', {}), 10_000);
    expect(p1?.mnemonic, JSON.stringify(p1)).toBeTruthy();
    try { await first.agent?.stop?.(); } catch { /* the process died */ }
    const second = await bootAgentBundle({ asyncStorage });
    const p2 = await within(second.callSkill('household', 'revealOwnerPhrase', {}), 10_000);
    expect(p2?.mnemonic).toBe(p1.mnemonic);
    const listed = await within(second.callSkill('agents', 'listAgents', {}), 10_000);
    expect(listed?.ok, JSON.stringify(listed)).not.toBe(false);
    try { await second.agent?.stop?.(); } catch { /* */ }
  });
});
