/**
 * attachPodToBundle / detachPodFromBundle — the device-independent
 * pod-attach activation shared by Pinboard web + mobile (platform-parity
 * principle). Bundle-derived identity/agentInfo/circleId; best-effort
 * provisioning; _podCtx wired; attachInner last.
 */

import { describe, it, expect, vi } from 'vitest';
import { attachPodToBundle, detachPodFromBundle } from '../src/lib/attachPodToBundle.js';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

function mkBundle(extra = {}) {
  const _podCtx = {};
  return {
    _podCtx,
    cache:        { attachInner: vi.fn(async () => {}) },
    podRouting:   { setAnchor: vi.fn() },
    pseudoPod:    { write: vi.fn(async () => {}) },
    agent:        { identity: { id: 'AID' }, address: 'addr-x' },
    groupId:      'bliep',
    deviceId:     'dev-1',
    localActor:   'https://id.example/me',
    ...extra,
  };
}

// HEAD ok → ensurePodProvisioned skips (idempotent) → no pod-onboarding.
const headOkFetch = vi.fn(async () => ({ ok: true }));

describe('attachPodToBundle', () => {
  it('setAnchor + _podCtx(classify/reverse) + attachInner(source); derives circle from bundle', async () => {
    const bundle = mkBundle();
    const source = { tag: 'SolidPodSource' };
    await attachPodToBundle({
      bundle, source, podRoot: 'https://pod/me/', webid: 'https://id/me#me', fetch: headOkFetch,
    });

    expect(bundle.podRouting.setAnchor).toHaveBeenCalledWith('https://pod/me/');
    expect(bundle._podCtx.classify).toBe(classify);
    expect(bundle._podCtx.reverse).toBe(reverseResolve);
    expect(bundle._podCtx.podRouting).toBe(bundle.podRouting);
    expect(bundle._podCtx.circleId).toBe('bliep');           // ← from bundle.groupId
    expect(bundle._podCtx.active).toBe(true);
    expect(bundle.cache.attachInner).toHaveBeenCalledWith(source);
  });

  it('explicit circleId overrides the bundle groupId', async () => {
    const bundle = mkBundle();
    await attachPodToBundle({
      bundle, source: {}, podRoot: 'https://pod/me/', fetch: headOkFetch, circleId: 'other-circle',
    });
    expect(bundle._podCtx.circleId).toBe('other-circle');
  });

  it('provision failure never blocks attach (best-effort)', async () => {
    const bundle = mkBundle();
    const boom = vi.fn(async () => { throw new Error('network down'); });
    await expect(attachPodToBundle({
      bundle, source: {}, podRoot: 'https://pod/me/', fetch: boom,
    })).resolves.toBeUndefined();
    expect(bundle._podCtx.active).toBe(true);              // routing still armed
    expect(bundle.cache.attachInner).toHaveBeenCalled();   // still attached
  });

  it('_podCtx inactive when there is no podRouting (no-pod-style bundle)', async () => {
    const bundle = mkBundle({ podRouting: undefined });
    await attachPodToBundle({ bundle, source: {}, podRoot: 'https://pod/me/', fetch: headOkFetch });
    expect(bundle._podCtx.active).toBe(false);              // byte-neutral
    expect(bundle.cache.attachInner).toHaveBeenCalled();
  });

  it('throws if the bundle has no CachingDataSource', async () => {
    await expect(attachPodToBundle({ bundle: { _podCtx: {} }, source: {}, podRoot: 'x', fetch: headOkFetch }))
      .rejects.toThrow(/attachInner/);
  });
});

describe('detachPodFromBundle', () => {
  it('clears _podCtx.active + reverts the anchor', () => {
    const bundle = mkBundle();
    bundle._podCtx.active = true;
    detachPodFromBundle({ bundle });
    expect(bundle._podCtx.active).toBe(false);
    expect(bundle.podRouting.setAnchor).toHaveBeenCalledWith(null);
  });

  it('tolerates a missing bundle / podRouting', () => {
    expect(() => detachPodFromBundle({ bundle: undefined })).not.toThrow();
    expect(() => detachPodFromBundle({ bundle: { _podCtx: {} } })).not.toThrow();
  });
});
