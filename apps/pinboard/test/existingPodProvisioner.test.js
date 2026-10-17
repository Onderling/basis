/**
 * existingPodProvisioner — Phase 2.2 unit (adopt-existing-pod
 * provisioner + idempotent ensurePodProvisioned). `provisionDefault`
 * is mocked: this pins OUR contract (createPod/createContainer/
 * putResource, HEAD-skip idempotency, never-throws).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const provisionDefault = vi.fn(async () => ({ podUri: 'x', webidUri: 'w' }));
vi.mock('@onderling/pod-onboarding', () => ({ provisionDefault }));

const { createExistingPodProvisioner, ensurePodProvisioned } =
  await import('../src/lib/existingPodProvisioner.js');

beforeEach(() => provisionDefault.mockClear());

describe('createExistingPodProvisioner', () => {
  it('createPod adopts the existing pod (no creation)', async () => {
    const f = vi.fn();
    const p = createExistingPodProvisioner({ podRoot: 'https://p/alice', webid: 'https://p/alice/profile#me', fetch: f });
    expect(await p.createPod()).toEqual({
      podUri: 'https://p/alice/', webidUri: 'https://p/alice/profile#me', fetch: f,
    });
  });

  it('createContainer is best-effort (swallows a failing PUT)', async () => {
    const f = vi.fn().mockRejectedValue(new Error('409'));
    const p = createExistingPodProvisioner({ podRoot: 'https://p/a/', webid: 'w', fetch: f });
    await expect(p.createContainer({ uri: 'https://p/a/private/' })).resolves.toBeUndefined();
    expect(f).toHaveBeenCalledWith('https://p/a/private/', expect.objectContaining({ method: 'PUT' }));
  });

  it('putResource PUTs and throws on a non-ok response', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const p1 = createExistingPodProvisioner({ podRoot: 'https://p/a/', webid: 'w', fetch: ok });
    await expect(p1.putResource({ uri: 'https://p/a/private/storage-mapping', body: { x: 1 }, contentType: 'application/json' }))
      .resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledWith('https://p/a/private/storage-mapping',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ x: 1 }) }));

    const bad = vi.fn().mockResolvedValue({ ok: false, status: 403 });
    const p2 = createExistingPodProvisioner({ podRoot: 'https://p/a/', webid: 'w', fetch: bad });
    await expect(p2.putResource({ uri: 'u', body: 'b' }))
      .rejects.toMatchObject({ code: 'PROVISIONER_FAILED', status: 403 });
  });

  it('does NOT expose setAcp / patchWebidProfile (V1 — provisionDefault skips them)', () => {
    const p = createExistingPodProvisioner({ podRoot: 'https://p/a/', webid: 'w', fetch: vi.fn() });
    expect(p.setAcp).toBeUndefined();
    expect(p.patchWebidProfile).toBeUndefined();
  });

  it('validates required args', () => {
    expect(() => createExistingPodProvisioner({ webid: 'w', fetch: vi.fn() })).toThrow(/podRoot/);
    expect(() => createExistingPodProvisioner({ podRoot: 'https://p/', webid: 'w' })).toThrow(/fetch/);
  });
});

describe('ensurePodProvisioned (idempotent, never throws)', () => {
  const base = { podRoot: 'https://p/a/', webid: 'w', pseudoPod: {}, identity: {}, agentInfo: { deviceId: 'd', agentUri: 'agent://x' } };

  it('skips when storage-mapping already exists (HEAD ok)', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const r = await ensurePodProvisioned({ ...base, fetch });
    expect(r).toEqual({ provisioned: false, skipped: true });
    expect(provisionDefault).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith('https://p/a/private/storage-mapping', { method: 'HEAD' });
  });

  it('provisions when storage-mapping is missing (HEAD throws)', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('404'));
    const r = await ensurePodProvisioned({ ...base, fetch });
    expect(r).toEqual({ provisioned: true });
    expect(provisionDefault).toHaveBeenCalledTimes(1);
    const arg = provisionDefault.mock.calls[0][0];
    expect(arg.podProvisioner).toBeTruthy();
    expect(arg.identity).toBe(base.identity);
    expect(arg.agentInfo).toBe(base.agentInfo);
  });

  it('never throws — provisioning failure returns {provisioned:false,error}', async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false });
    provisionDefault.mockRejectedValueOnce(new Error('pod down'));
    const r = await ensurePodProvisioned({ ...base, fetch });
    expect(r.provisioned).toBe(false);
    expect(r.error).toBeInstanceOf(Error);
  });
});
