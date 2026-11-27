/**
 * objective L follow-up — the mobile composition root threads the LIVE circle policy + the signed-in identity
 * (invariant #2 web≡mobile). Proves the two honest gaps flagged on the mobile share path are closed:
 *
 *   1. `policyOf` no longer defaults to `{}` (→ 'closed', deny-by-default). With a circle whose persisted
 *      policy is `sharePosture:'canonical'`, `shareItemIntoCircle`/`unshareItemFromCircle` pass a `policyOf`
 *      that resolves THAT posture — sourced from the module-level `makeCirclePolicyStoreRN` (same
 *      `basis.circlePolicy.<id>` keys the launcher writes), mirroring web's `_circlePolicy`.
 *   2. The signed-in member's WebID is threaded as `by` (share initiator) + `recipient` (read subject),
 *      mirroring web's `by ?? LOCAL_ACTOR` / `recipient ?? circleOwnerWebId`.
 *
 * The SHARED share ops are MOCKED so we assert exactly the args the wrappers hand them (no live pod/crypto).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { shareSpy, listSpy, revokeSpy } = vi.hoisted(() => ({
  shareSpy: vi.fn(async () => ({ ok: true, ref: {} })),
  listSpy: vi.fn(async () => []),
  revokeSpy: vi.fn(async () => ({ ok: true })),
}));

// Intercept the SHARED cross-circle share ops the mobile composition root wires — the exact module circlePods.js
// imports — so we can read back the `policyOf` / `by` / `recipient` the wrappers thread.
vi.mock('../../basis/src/v2/circleShare.js', () => ({
  shareItemAcrossCircles: (args) => shareSpy(args),
  listSharedResolved: (args) => listSpy(args),
  revokeItemShare: (args) => revokeSpy(args),
}));

import {
  initCirclePods, setCirclePodSession,
  shareItemIntoCircle, listSharedItems, unshareItemFromCircle,
} from '../src/core/circlePods.js';
import { normalizeCirclePolicy } from '../../basis/src/v2/circlePolicy.js';

const WEBID = 'https://alice.pod.example/profile/card#me';

// A minimal AsyncStorage mock (the same shape the other mobile tests use).
function mockAsyncStorage() {
  const m = new Map();
  return {
    getItem: async (k) => (m.has(k) ? m.get(k) : null),
    setItem: async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
  };
}

function signedInSession() {
  return { current: { isAuthenticated: () => true, webid: WEBID, getAuthenticatedFetch: () => () => {} } };
}

describe('mobile share path threads live posture + signed-in identity (objective L)', () => {
  beforeEach(() => { shareSpy.mockClear(); listSpy.mockClear(); revokeSpy.mockClear(); });

  it('shareItemIntoCircle threads the circle\'s LIVE sharePosture via policyOf (not {}) + the WebID as `by`', async () => {
    const store = mockAsyncStorage();
    // Persist circle A's policy BEFORE wiring the store — the launcher writes these same keys.
    await store.setItem('basis.circlePolicy.A', JSON.stringify({ sharePosture: 'canonical' }));
    initCirclePods(store);
    setCirclePodSession(signedInSession());

    // No policyOf / by threaded by the caller → the composition-root defaults must fill them.
    const r = await shareItemIntoCircle({ itemId: 'i1', fromCircleId: 'A', toCircleId: 'B' });
    expect(r.ok).toBe(true);
    expect(shareSpy).toHaveBeenCalledTimes(1);
    const args = shareSpy.mock.calls[0][0];

    // (1) LIVE posture flows through policyOf — the source circle resolves 'canonical', NOT the deny-by-default {}.
    const pol = await args.policyOf('A');
    expect(pol.sharePosture).toBe('canonical');
    // (2) the signed-in WebID is the initiator.
    expect(args.by).toBe(WEBID);

    setCirclePodSession(null);
  });

  it('listSharedItems defaults the read subject `recipient` to the signed-in WebID', async () => {
    initCirclePods(mockAsyncStorage());
    setCirclePodSession(signedInSession());

    await listSharedItems('A');
    expect(listSpy).toHaveBeenCalledTimes(1);
    expect(listSpy.mock.calls[0][0].recipient).toBe(WEBID);

    setCirclePodSession(null);
  });

  it('unshareItemFromCircle threads the LIVE posture via policyOf', async () => {
    const store = mockAsyncStorage();
    await store.setItem('basis.circlePolicy.A', JSON.stringify({ sharePosture: 'canonical' }));
    initCirclePods(store);
    setCirclePodSession(signedInSession());

    await unshareItemFromCircle({ itemId: 'i1', fromCircleId: 'A', toCircleId: 'B', recipient: 'did:bob' });
    expect(revokeSpy).toHaveBeenCalledTimes(1);
    const pol = await revokeSpy.mock.calls[0][0].policyOf('A');
    expect(pol.sharePosture).toBe('canonical');

    setCirclePodSession(null);
  });

  it('signed out ⇒ no identity, policy absent → deny-by-default (safe fallback preserved)', async () => {
    setCirclePodSession(null);
    // A fresh circleId with no persisted policy → policyOf resolves deny-by-default ({} or normalized 'closed').
    await shareItemIntoCircle({ itemId: 'i1', fromCircleId: 'ZZ', toCircleId: 'B' });
    const args = shareSpy.mock.calls[0][0];
    expect(args.by).toBeUndefined();
    // Whether the source is the raw {} (no store) or the store's normalized default, the posture is 'closed'.
    expect(normalizeCirclePolicy(await args.policyOf('ZZ')).sharePosture).toBe('closed');
  });
});
