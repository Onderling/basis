/**
 * Mobile per-circle pod producers + content-seal strategy (RN parity with web). Drives the
 * REAL sealing substrate (pure-JS tweetnacl/@noble — RN-safe) over an in-memory pseudo-pod
 * + an injected mock AsyncStorage vault. Proves a p2 circle resolves a working seal/open
 * strategy and a p0 circle resolves none (cleartext).
 */
import { describe, it, expect, vi } from 'vitest';
import {
  initCirclePods, getCircleSealStrategy, setCirclePodSession, getActiveRealPodRouting,
  ensureCirclePod, setCircleKeyEventWiring, recordCircleKeyEvent,
} from '../src/core/circlePods.js';
import { rotateKeyEvent, sealWithGroupKey } from '@onderling/pod-client';

function mockAsyncStorage() {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
  };
}

describe('mobile circlePods', () => {
  it('p2 circle resolves a content seal/open strategy that round-trips', async () => {
    initCirclePods(mockAsyncStorage());
    const strat = await getCircleSealStrategy('mob-p2', { storagePosture: 'p2' });
    expect(strat).toBeTruthy();
    expect(strat.open(strat.seal('hoi kring'))).toBe('hoi kring');
  });

  it('p0 circle → null strategy (cleartext, no sealing)', async () => {
    initCirclePods(mockAsyncStorage());
    const strat = await getCircleSealStrategy('mob-p0', { storagePosture: 'p0' });
    expect(strat).toBeNull();
  });

  it('caches the strategy per circle (stable across calls)', async () => {
    initCirclePods(mockAsyncStorage());
    const a = await getCircleSealStrategy('mob-cache', { storagePosture: 'p2' });
    const b = await getCircleSealStrategy('mob-cache', { storagePosture: 'p2' });
    expect(a).toBe(b);
  });

  // RN authenticated-fetch unblock: a signed-in OidcSessionRN routes sealed circles to the real pod.
  it('no session → no real-pod routing (pseudo-pod path)', () => {
    setCirclePodSession(null);
    expect(getActiveRealPodRouting()).toBeNull();
  });

  it('authenticated OidcSessionRN → real-pod routing using the session\'s authenticated fetch', () => {
    const fetch = vi.fn();
    const session = {
      isAuthenticated: () => true,
      webid: 'https://me.pod/profile/card#me',
      getAuthenticatedFetch: () => fetch,
    };
    setCirclePodSession({ current: session });           // App-owned ref shape
    const r = getActiveRealPodRouting();
    expect(r).toBeTruthy();
    expect(r.podRoot).toBe('https://me.pod/');
    expect(r.circleRootUri('c1')).toBe('https://me.pod/circles/c1');
    // the producer's pod client is built over the session's fetch (not the pseudo-pod)
    expect(r.makePodClient('c1')).toBeTruthy();
    setCirclePodSession(null);                            // reset for other tests
  });

  it('not-authenticated session → null (falls back to pseudo-pod)', () => {
    setCirclePodSession({ current: { isAuthenticated: () => false, webid: null, getAuthenticatedFetch: () => {} } });
    expect(getActiveRealPodRouting()).toBeNull();
    setCirclePodSession(null);
  });
});

// ── G11 — no-pod group-key rotation, the MOBILE wiring (journeys J-G11.1/2) ─────────────────────────
// The shared mechanics (rotation reaches the bystander, offline catch-up, backward secrecy) are proven in
// basis's noPodKeyRotationThreeDevice.test.js — these tests pin the RN chain around them: the bundle-injected
// wiring feeds the EMIT sink, and a key-event recorded on RECEIVE feeds the seal strategy's fold.
describe('mobile circlePods — G11 no-pod rotation wiring', () => {
  it('removing a member fans the rotation key-event to the REMAINING members only', async () => {
    initCirclePods(mockAsyncStorage());
    const sent = [];
    // Two members besides the controller; sealing keys are minted by addMember below.
    const bram = { webid: 'did:bram', addr: 'addr:bram' };
    const cato = { webid: 'did:cato', addr: 'addr:cato' };
    const keys = {};   // webid → sealing publicKey (filled once granted)
    setCircleKeyEventWiring({
      sendPeer: (addr, payload) => { sent.push({ addr, payload }); },
      callSkill: async (_o, opId) => (opId === 'listGroupMembers'
        ? { members: [bram, cato].map((m) => ({ ...m, sealingPublicKey: keys[m.webid] })) }
        : {}),
    });

    const prod = await ensureCirclePod('g11-fan', { storagePosture: 'p2' });
    expect(prod?.controlAgent).toBeTruthy();
    // Establish the key (the strategy resolve bootstraps), then grant the two members.
    expect(await getCircleSealStrategy('g11-fan', { storagePosture: 'p2' })).toBeTruthy();
    const { generateKeypair } = await import('@onderling/pod-client');
    for (const m of [bram, cato]) {
      keys[m.webid] = generateKeypair().publicKey;
      await prod.controlAgent.addMember({ webId: m.webid, publicKey: keys[m.webid], role: 'member' });
    }

    sent.length = 0;
    await prod.controlAgent.removeMember({ webId: cato.webid, force: true });

    // The rotation event went to Bram (the bystander) over the injected peer sender — and NOT to Cato:
    // the departed is absent from the event's recipients, so the roster match naturally excludes them.
    const fanned = sent.filter((s) => s.payload?.subtype === 'group-key-event');
    expect(fanned.length).toBeGreaterThan(0);
    expect(fanned.map((s) => s.addr)).toContain('addr:bram');
    expect(fanned.map((s) => s.addr)).not.toContain('addr:cato');
    setCircleKeyEventWiring(null);
  });

  it('a key-event recorded on RECEIVE feeds the strategy fold: log-only versions open', async () => {
    initCirclePods(mockAsyncStorage());
    const prod = await ensureCirclePod('g11-fold', { storagePosture: 'p2' });
    const strat = await getCircleSealStrategy('g11-fold', { storagePosture: 'p2' });
    expect(strat).toBeTruthy();

    // A rotation fanned BY ANOTHER MEMBER lands only in the local key-event log (the pod key resource
    // knows nothing of it) — sealed to THIS device's per-circle sealing identity, as a real fan would be.
    const idKey = await prod.sealingIdentity.ensure();
    const { groupKey, event } = rotateKeyEvent({
      groupId: 'g11-fold', fromVersion: 41, recipients: [idKey.publicKey],
    });
    expect(recordCircleKeyEvent('g11-fold', event)).toBe(true);

    // Content sealed under that log-only version opens through the fold (the pod reader alone cannot).
    expect(strat.open(sealWithGroupKey('na de rotatie', groupKey))).toBe('na de rotatie');
  });

  it('recording a key-event drops the cached seal strategy (the stale-seal guard)', async () => {
    initCirclePods(mockAsyncStorage());
    const prod = await ensureCirclePod('g11-stale', { storagePosture: 'p2' });
    const a = await getCircleSealStrategy('g11-stale', { storagePosture: 'p2' });
    expect(a).toBeTruthy();
    // A rotation lands (any route) → the next seal must RE-RESOLVE, not keep sealing the old version:
    // the departed member still holds that old key, so a cache-lifetime seal would leak post-removal
    // content to them. Backward secrecy must not depend on a cache.
    const idKey = await prod.sealingIdentity.ensure();
    const { event } = rotateKeyEvent({ groupId: 'g11-stale', fromVersion: 1, recipients: [idKey.publicKey] });
    expect(recordCircleKeyEvent('g11-stale', event)).toBe(true);
    const b = await getCircleSealStrategy('g11-stale', { storagePosture: 'p2' });
    expect(b).not.toBe(a);
  });
});
