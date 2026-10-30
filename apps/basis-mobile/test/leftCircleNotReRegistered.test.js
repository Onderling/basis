/**
 * A circle this device left, or was removed from, is never registered again. The mobile bundle's no-argument
 * `registerCirclePresence()` (a new socket re-registers) asked the substrate for "my circles" but UNIONED that with
 * the last list it registered, so a circle the person had since left stayed in the list and its address went back
 * onto the relay. Web and the box read the list fresh. This boots the real bundle and watches what gets primed.
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

describe('a left or removed circle on a re-register', () => {
  it('is not primed or registered again from the cached list', { timeout: 120_000 }, async () => {
    const bundle = await bootAgentBundle({ asyncStorage: fakeAsyncStorage() });
    const { agent } = bundle;
    const primed = [];
    agent.installCircleIdentities = async (ids) => { primed.push([...ids]); };
    let mine = { circles: ['kept', 'left-one', 'removed-one'], left: [], removed: [] };
    const raw = agent.callSkill.bind(agent);
    agent.callSkill = (app, op, args) => (app === 'pinboard' && op === 'listMyCircles' ? Promise.resolve(mine) : raw(app, op, args));

    await bundle.registerCirclePresence();
    expect(primed.at(-1)).toEqual(expect.arrayContaining(['kept', 'left-one', 'removed-one']));

    // the person left one circle and was removed from another; the fold says so
    mine = { circles: ['kept'], left: ['left-one'], removed: [{ id: 'removed-one', name: 'Weg' }] };
    await bundle.registerCirclePresence();
    expect(primed.at(-1), 'only the circle still held').toEqual(['kept']);
    try { await agent.stop?.(); } catch { /* */ }
  });
});
