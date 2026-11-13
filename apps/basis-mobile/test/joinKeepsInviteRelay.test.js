/**
 * A JOIN KEEPS THE INVITE'S RELAY: after the launcher's join wizard joins a circle from an invite, the next start of the
 * app connects to that relay again. The phone had two "after a join" hooks; the one the launcher and the chat screen
 * get (`bundle.onCircleJoined`) did not record the invite's connection point, so after a restart the phone was on no
 * relay and every line waited ("No connection point"). Found by the personas walk (e2e/personas.test.js).
 */
import { describe, it, expect } from 'vitest';
import { bootAgentBundle, resolveBootRelayUrls } from '../src/core/agentBundle.js';

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

describe("a join keeps the invite's relay for the next start", () => {
  it("the launcher's join hook records the invite's relay; the next boot connects to it", { timeout: 120_000 }, async () => {
    const bundle = await bootAgentBundle({ asyncStorage: fakeAsyncStorage() });
    const RELAY = `ws://relay-${Date.now().toString(36)}.example:8787`;
    await bundle.onCircleJoined({ circleId: 'werk', invite: { relayUrl: RELAY, groupId: 'werk' } });
    expect(await resolveBootRelayUrls()).toContain(RELAY);
    try { await bundle.agent.stop?.(); } catch { /* */ }
  });
});
