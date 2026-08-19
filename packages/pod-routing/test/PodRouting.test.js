/**
 * createPodRouting — end-to-end resolver + config + reachability.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createPodRouting } from '../src/PodRouting.js';

function mkPod(deviceId = 'laptop-anne') {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
}

describe('createPodRouting — construction', () => {
  it('throws on missing pseudoPod', () => {
    expect(() => createPodRouting({ deviceId: 'd' }))
      .toThrow(/pseudoPod/);
  });

  it('throws on missing deviceId', () => {
    expect(() => createPodRouting({ pseudoPod: mkPod() }))
      .toThrow(/deviceId/);
  });

  it('exposes deviceId + configResourceUri', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'laptop-anne' });
    expect(r.deviceId).toBe('laptop-anne');
    expect(r.configResourceUri).toBe('pseudo-pod://laptop-anne/private/storage-mapping');
  });
});

describe('podRouting.resolve — defaults (no-pod)', () => {
  it('resolves private/* to the pseudo-pod', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(r.resolve('private/identity-vault')).toBe('pseudo-pod://d/private/identity-vault');
  });

  it('resolves sharing/profile-public to the canonical card path', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(r.resolve('sharing/profile-public')).toBe('pseudo-pod://d/sharing/public/profile-card');
  });

  it('resolves sharing/<other> via glob', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(r.resolve('sharing/tasks/abc')).toBe('pseudo-pod://d/sharing/tasks/abc');
  });

  it('returns null on unknown storage function', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(r.resolve('weird/path')).toBe(null);
  });
});

describe('podRouting.setAnchor — no-pod → pod and back', () => {
  it('re-points defaults + config URI when an anchor is set, and reverts on null', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    // starts no-pod
    expect(r.resolve('private/identity-vault')).toBe('pseudo-pod://d/private/identity-vault');
    expect(r.circlePolicy('c')).toEqual({ policy: 'no-pod' });

    // attach a pod → defaults + circle policy re-point to the anchor.
    // (configResourceUri is intentionally anchor-independent in V0 —
    // the storage-mapping always lives in the local pseudo-pod mirror;
    // setAnchor returns it for forward-compat.)
    const cfg = r.setAnchor('https://anne.pod');
    expect(r.resolve('private/identity-vault')).toBe('https://anne.pod/private/identity-vault');
    expect(r.circlePolicy('c')).toEqual({ policy: 'centralised', groupPodUri: 'https://anne.pod' });
    expect(r.anchorPodUri).toBe('https://anne.pod');
    expect(cfg).toBe(r.configResourceUri);

    // revert to no-pod
    r.setAnchor(null);
    expect(r.resolve('private/identity-vault')).toBe('pseudo-pod://d/private/identity-vault');
    expect(r.circlePolicy('c')).toEqual({ policy: 'no-pod' });
    expect(r.anchorPodUri).toBe(null);
  });

  it('rejects a non-string, non-null anchor', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(() => r.setAnchor(123)).toThrow(/anchorPodUri/);
  });
});

describe('podRouting.resolve — defaults (pod-having)', () => {
  it('resolves private/* to anchor pod', () => {
    const r = createPodRouting({
      pseudoPod:    mkPod(),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    expect(r.resolve('private/identity-vault')).toBe('https://anne.pod/private/identity-vault');
  });

  it('resolves sharing/<resource> to anchor pod', () => {
    const r = createPodRouting({
      pseudoPod:    mkPod(),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    expect(r.resolve('sharing/tasks/abc')).toBe('https://anne.pod/sharing/tasks/abc');
  });

  it('default circle policy is centralised on the anchor pod', () => {
    const r = createPodRouting({
      pseudoPod:    mkPod(),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    expect(r.circlePolicy('any-circle')).toEqual({
      policy:      'centralised',
      groupPodUri: 'https://anne.pod',
    });
  });
});

describe('podRouting.resolve — group routing via circle policy', () => {
  it('centralised circle resolves to groupPodUri', async () => {
    const r = createPodRouting({
      pseudoPod:    mkPod('d'),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    await r.setCirclePolicy('circle-abc', {
      policy:      'centralised',
      groupPodUri: 'https://anne.pod',
    });
    expect(r.resolve('group/circle-abc/tasks/x'))
      .toBe('https://anne.pod/circle-abc/tasks/x');
  });

  it('no-pod circle resolves to pseudo-pod replication-ring path', async () => {
    const r = createPodRouting({ pseudoPod: mkPod('d'), deviceId: 'd' });
    await r.setCirclePolicy('household-xyz', { policy: 'no-pod' });
    expect(r.resolve('group/household-xyz/tasks/x'))
      .toBe('pseudo-pod://d/group/household-xyz/tasks/x');
  });

  it('decentralised circle resolves to the user’s OWN anchor pod (circle-scoped)', async () => {
    const r = createPodRouting({
      pseudoPod:    mkPod('d'),
      deviceId:     'd',
      anchorPodUri: 'https://me.pod',
    });
    await r.setCirclePolicy('nb', { policy: 'decentralised' });
    expect(r.resolve('group/nb/items/1.json'))
      .toBe('https://me.pod/nb/items/1.json');
  });

  it('decentralised with NO anchor pod falls back to the replication ring', async () => {
    const r = createPodRouting({ pseudoPod: mkPod('d'), deviceId: 'd' });
    await r.setCirclePolicy('nb', { policy: 'decentralised' });
    expect(r.resolve('group/nb/items/1.json'))
      .toBe('pseudo-pod://d/group/nb/items/1.json');
  });

  it('hybrid ledger resolves to the shared group pod (== centralised for circle data)', async () => {
    const r = createPodRouting({ pseudoPod: mkPod('d'), deviceId: 'd' });
    await r.setCirclePolicy('hh', { policy: 'hybrid', groupPodUri: 'https://grp.pod' });
    expect(r.resolve('group/hh/items/1.json'))
      .toBe('https://grp.pod/hh/items/1.json');
  });

  it('hybrid with no groupPodUri falls back to the replication ring', async () => {
    const r = createPodRouting({ pseudoPod: mkPod('d'), deviceId: 'd' });
    await r.setCirclePolicy('hh', { policy: 'hybrid' });
    expect(r.resolve('group/hh/items/1.json'))
      .toBe('pseudo-pod://d/group/hh/items/1.json');
  });

  it('explicit mapping overrides circle-policy resolution', async () => {
    const r = createPodRouting({
      pseudoPod:    mkPod('d'),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    await r.updateMapping({
      fn:  'group/circle-abc/*',
      uri: 'https://other.pod/special/',
    });
    expect(r.resolve('group/circle-abc/tasks/x'))
      .toBe('https://other.pod/special/tasks/x');
  });

  it('group routing uses the explicit policy.groupPodUri', async () => {
    const r = createPodRouting({ pseudoPod: mkPod('d'), deviceId: 'd' });
    await r.setCirclePolicy('circle-x', {
      policy:      'centralised',
      groupPodUri: 'https://bob.pod',
    });
    expect(r.resolve('group/circle-x/notes/n1'))
      .toBe('https://bob.pod/circle-x/notes/n1');
  });
});

describe('podRouting — config persistence (reload + updateMapping)', () => {
  it('updateMapping persists + reloads', async () => {
    const pseudoPod = mkPod();
    const r = createPodRouting({ pseudoPod, deviceId: 'laptop-anne' });

    await r.updateMapping({ fn: 'sharing/*', uri: 'pseudo-pod://laptop-anne/share-v2/' });
    expect(r.resolve('sharing/tasks/x')).toBe('pseudo-pod://laptop-anne/share-v2/tasks/x');

    // Build a fresh router on the same pseudo-pod — should see the config.
    const r2 = createPodRouting({ pseudoPod, deviceId: 'laptop-anne' });
    expect(r2.config).toBe(null);  // not loaded yet
    await r2.reload();
    expect(r2.config?.mappings?.['sharing/*']).toBe('pseudo-pod://laptop-anne/share-v2/');
    expect(r2.resolve('sharing/tasks/x')).toBe('pseudo-pod://laptop-anne/share-v2/tasks/x');
  });

  it('reload tolerates missing config (defaults remain in effect)', async () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    await r.reload();
    expect(r.config).toBe(null);
    expect(r.resolve('private/identity-vault')).toBe('pseudo-pod://d/private/identity-vault');
  });

  it('reload surfaces INVALID_CONFIG errors', async () => {
    const pseudoPod = mkPod();
    await pseudoPod.write(
      'pseudo-pod://laptop-anne/private/storage-mapping',
      42,  // not an object → invalid
    );
    const r = createPodRouting({ pseudoPod, deviceId: 'laptop-anne' });
    await expect(r.reload()).rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});

describe('podRouting.isPodReachable', () => {
  it('no anchor pod → false (caller can fall back to ring)', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(r.isPodReachable()).toBe(false);
  });

  it('anchor pod → reachable by default', () => {
    const r = createPodRouting({
      pseudoPod:    mkPod(),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    expect(r.isPodReachable()).toBe(true);
  });

  it('markPodUnreachable flips verdict; markPodReachable flips back', () => {
    const r = createPodRouting({
      pseudoPod:    mkPod(),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
      reachabilityTTLms: 60_000,
    });
    r.markPodUnreachable();
    expect(r.isPodReachable()).toBe(false);
    r.markPodReachable();
    expect(r.isPodReachable()).toBe(true);
  });

  it('pseudo-pod URIs are always reachable', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    expect(r.isPodReachable('pseudo-pod://anywhere/x')).toBe(true);
  });

  it('per-URI reachability is tracked separately', () => {
    const r = createPodRouting({
      pseudoPod:    mkPod(),
      deviceId:     'd',
      anchorPodUri: 'https://anne.pod',
    });
    r.markPodUnreachable('https://other.pod');
    expect(r.isPodReachable('https://other.pod')).toBe(false);
    expect(r.isPodReachable('https://anne.pod')).toBe(true);
  });
});

describe('podRouting — storage-function registry', () => {
  it('lists canonical + registered extras (sorted)', () => {
    const r = createPodRouting({ pseudoPod: mkPod(), deviceId: 'd' });
    r.registerStorageFunction('app-extension/x');
    expect(r.listStorageFunctions()).toContain('app-extension/x');
    expect(r.listStorageFunctions()).toContain('private/identity-vault');
  });
});

describe('podRouting — variable substitution', () => {
  it('substitutes caller-provided vars in user mapping URIs', async () => {
    const pseudoPod = mkPod();
    const r = createPodRouting({ pseudoPod, deviceId: 'laptop-anne' });
    await r.updateMapping({
      fn:  'private/state/<app>',
      uri: 'pseudo-pod://laptop-anne/state/<app>/',
    });
    expect(r.resolve('private/state/<app>', { app: 'tasks' }))
      .toBe('pseudo-pod://laptop-anne/state/tasks/');
  });
});
