/**
 * A POLICY WRITE THAT CHANGES WHERE OR HOW A CIRCLE KEEPS ITS DATA DROPS WHAT WAS BUILT FROM THE OLD ONE. A circle's pod
 * producer is built from its policy (the pod, the posture) and kept per circle; a policy write dropped the cached
 * strategy but never the cached PRODUCER, so a producer built on half a policy (a `pod` still at its default) outlived
 * the real policy and a shared-pod member never found the circle's pod (measured on a train, 2026-11-15). Now every
 * policy store announces a change of `pod` or posture, and the phone's producer cache drops the circle's producer and
 * strategy; the next use builds them from the policy in force. A change of anything else keeps them.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { initCirclePods, ensureCirclePod } from '../src/core/circlePods.js';
import { createCirclePolicyStore } from '../../basis/src/v2/circlePolicyStore.js';
import { bindCircleKeyPairs } from './support/circleKeyPairs.js';
import { useTestContentSeal } from './support/contentSeal.js';

useTestContentSeal();

function mockAsyncStorage() {
  const m = new Map();
  return { getItem: async (k) => (m.has(k) ? m.get(k) : null), setItem: async (k, v) => { m.set(k, String(v)); }, removeItem: async (k) => { m.delete(k); } };
}
const memIo = () => { const m = new Map(); return { load: async (id) => m.get(id) ?? null, save: async (id, v) => { m.set(id, v); } }; };

describe('a policy write that changes the pod or the posture', () => {
  beforeEach(() => bindCircleKeyPairs());

  it('drops the kept producer; the next use builds a new one', async () => {
    initCirclePods(mockAsyncStorage());
    const store = createCirclePolicyStore(memIo());
    await store.update('c-drop', { storagePosture: 'p2', pod: 'none' });
    const first = await ensureCirclePod('c-drop', await store.get('c-drop'));
    expect(first).toBeTruthy();
    expect(await ensureCirclePod('c-drop', await store.get('c-drop')), 'kept while nothing changed').toBe(first);
    await store.update('c-drop', { pod: 'shared' });
    const second = await ensureCirclePod('c-drop', await store.get('c-drop'));
    expect(second, 'built again from the policy in force').not.toBe(first);
  });

  it('a change of anything else keeps the producer', async () => {
    initCirclePods(mockAsyncStorage());
    const store = createCirclePolicyStore(memIo());
    await store.update('c-keep', { storagePosture: 'p2', pod: 'none' });
    const first = await ensureCirclePod('c-keep', await store.get('c-keep'));
    await store.update('c-keep', { features: { calendar: true } });
    expect(await ensureCirclePod('c-keep', await store.get('c-keep'))).toBe(first);
  });
});
