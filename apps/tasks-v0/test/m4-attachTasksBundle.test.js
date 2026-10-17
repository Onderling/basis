/**
 * Tasks M4 — attachTasksBundle / detachTasksBundle.
 *
 * Device-independent analog of apps/pinboard/test/attachPodToBundle.test.js,
 * adapted for Tasks. Asserts: setAnchor + _podCtx(classify/reverse)
 * + attachInner(source); bundle-derived circleId; provision callback
 * called best-effort; detach resets active + anchor.
 *
 * NOTE: written, not run here — orchestrator verifies in the main
 * tree (worktree node_modules is the known-incomplete install).
 */

import { describe, it, expect, vi } from 'vitest';
import { attachTasksBundle, detachTasksBundle } from '../src/lib/attachTasksBundle.js';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

function mkBundle(extra = {}) {
  const _podCtx = {
    active:    false,
    classify:  null,
    reverse:   null,
    podRouting: null,
    circleId:    null,
    vars:      null,
  };
  return {
    _podCtx,
    cache:           { attachInner: vi.fn(async () => {}) },
    podRouting:      { setAnchor: vi.fn(), resolve: vi.fn(() => 'https://pod.example/fn/') },
    pseudoPod:       null,
    substrateDeviceId: 'dev-1',
    circleId:          'circle-test',
    ...extra,
  };
}

const headOkFetch = vi.fn(async () => ({ ok: true }));

describe('attachTasksBundle', () => {
  it('calls setAnchor, fills _podCtx with classify/reverse, calls attachInner(source)', async () => {
    const bundle = mkBundle();
    const source = { tag: 'SolidPodSource' };
    await attachTasksBundle({
      bundle, source, podRoot: 'https://pod.example/me/', fetch: headOkFetch,
    });

    expect(bundle.podRouting.setAnchor).toHaveBeenCalledWith('https://pod.example/me/');
    expect(bundle._podCtx.classify).toBe(classify);
    expect(bundle._podCtx.reverse).toBe(reverseResolve);
    expect(bundle._podCtx.podRouting).toBe(bundle.podRouting);
    expect(bundle._podCtx.circleId).toBe('circle-test');   // ← from bundle.circleId
    expect(bundle._podCtx.active).toBe(true);
    expect(bundle.cache.attachInner).toHaveBeenCalledWith(source);
  });

  it('explicit circleId overrides bundle.circleId', async () => {
    const bundle = mkBundle();
    await attachTasksBundle({
      bundle, source: {}, podRoot: 'https://pod.example/me/', fetch: headOkFetch,
      circleId: 'override-circle',
    });
    expect(bundle._podCtx.circleId).toBe('override-circle');
  });

  it('calls the provision callback when supplied', async () => {
    const bundle = mkBundle();
    const provision = vi.fn(async () => {});
    await attachTasksBundle({
      bundle, source: {}, podRoot: 'https://pod.example/me/', fetch: headOkFetch, provision,
    });
    expect(provision).toHaveBeenCalledWith(
      expect.objectContaining({ podRoot: 'https://pod.example/me/', fetch: headOkFetch }),
    );
    expect(bundle._podCtx.active).toBe(true);
    expect(bundle.cache.attachInner).toHaveBeenCalled();
  });

  it('provision failure never blocks attach (best-effort)', async () => {
    const bundle = mkBundle();
    const boom = vi.fn(async () => { throw new Error('network down'); });
    await expect(attachTasksBundle({
      bundle, source: {}, podRoot: 'https://pod.example/me/', fetch: headOkFetch,
      provision: boom,
    })).resolves.toBeUndefined();
    expect(bundle._podCtx.active).toBe(true);           // routing still armed
    expect(bundle.cache.attachInner).toHaveBeenCalled(); // still attached
  });

  it('_podCtx stays inactive when there is no podRouting (no-pod bundle)', async () => {
    const bundle = mkBundle({ podRouting: undefined });
    await attachTasksBundle({ bundle, source: {}, podRoot: 'https://pod.example/me/', fetch: headOkFetch });
    expect(bundle._podCtx.active).toBe(false); // byte-neutral — no routing
    expect(bundle.cache.attachInner).toHaveBeenCalled();
  });

  it('skips _podCtx fill when bundle has no _podCtx (graceful)', async () => {
    const bundle = mkBundle();
    delete bundle._podCtx;
    await expect(attachTasksBundle({
      bundle, source: {}, podRoot: 'https://pod.example/me/', fetch: headOkFetch,
    })).resolves.toBeUndefined();
    expect(bundle.cache.attachInner).toHaveBeenCalled();
  });

  it('throws if the bundle has no CachingDataSource', async () => {
    await expect(attachTasksBundle({ bundle: { _podCtx: {} }, source: {}, podRoot: 'x', fetch: headOkFetch }))
      .rejects.toThrow(/attachInner/);
  });
});

describe('detachTasksBundle', () => {
  it('clears _podCtx.active + reverts the anchor', () => {
    const bundle = mkBundle();
    bundle._podCtx.active = true;
    detachTasksBundle({ bundle });
    expect(bundle._podCtx.active).toBe(false);
    expect(bundle.podRouting.setAnchor).toHaveBeenCalledWith(null);
  });

  it('tolerates a missing bundle / podRouting gracefully', () => {
    expect(() => detachTasksBundle({ bundle: undefined })).not.toThrow();
    expect(() => detachTasksBundle({ bundle: { _podCtx: {} } })).not.toThrow();
  });
});
