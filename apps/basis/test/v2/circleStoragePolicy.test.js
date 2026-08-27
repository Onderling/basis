/**
 * circleStoragePolicy — the calls that drive stoop's authoritative circle storage policy, over a fake
 * callSkill (no pod, no network).
 *
 * This file used to test a TRANSLATION: basis said `none|shared|personal|hybrid`, stoop said
 * `no-pod|centralised|decentralised|hybrid`, and the module mapped between them. Its round-trip test
 * proved the map was lossless — which was also the proof the two vocabularies were one thing, sitting
 * here unread while "do they cut the space differently?" stayed open. Both sides speak one vocabulary
 * now, so the translation is deleted rather than kept as a no-op, and what is tested is what remains:
 * that a posture crosses the seam UNCHANGED.
 */
import { describe, it, expect, vi } from 'vitest';
import { loadCircleStoragePod, pushCircleStoragePolicy } from '../../src/v2/circleStoragePolicy.js';
import { CIRCLE_STORAGE_POSTURE_NAMES } from '@onderling/pod-routing';

describe('the seam no longer translates', () => {
  it('every posture crosses to stoop unchanged', async () => {
    for (const posture of CIRCLE_STORAGE_POSTURE_NAMES) {
      const callSkill = vi.fn(async () => ({ storage: { policy: posture } }));
      await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: posture });
      expect(callSkill.mock.calls[0][2].storagePolicy, posture).toBe(posture);
    }
  });

  it('and comes back unchanged', async () => {
    for (const posture of CIRCLE_STORAGE_POSTURE_NAMES) {
      const callSkill = vi.fn(async () => ({ policy: posture, groupPodUri: null }));
      expect((await loadCircleStoragePod({ callSkill, circleId: 'c-1' })).pod).toBe(posture);
    }
  });

  it('a retired word from stoop reads as no pod, never as one', async () => {
    // Downward is the safe direction: assuming a pod means writing somewhere nobody agreed to.
    const callSkill = vi.fn(async () => ({ policy: 'centralised', groupPodUri: 'https://pod/' }));
    expect((await loadCircleStoragePod({ callSkill, circleId: 'c-1' })).pod).toBe('none');
  });
});

describe('pushCircleStoragePolicy', () => {
  it('calls stoop.setCircleStoragePolicy with the posture + circleId as groupId', async () => {
    const callSkill = vi.fn(async () => ({ groupId: 'c-1', storage: { policy: 'shared', groupPodUri: 'https://pod/' } }));
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'shared', groupPodUri: 'https://pod/' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'setCircleStoragePolicy', {
      groupId: 'c-1', storagePolicy: 'shared', groupPodUri: 'https://pod/',
    });
    expect(r).toEqual({ ok: true, storage: { policy: 'shared', groupPodUri: 'https://pod/' } });
  });

  it('omits groupPodUri when not supplied (e.g. personal)', async () => {
    const callSkill = vi.fn(async () => ({ storage: { policy: 'personal' } }));
    await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'personal' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'setCircleStoragePolicy', { groupId: 'c-1', storagePolicy: 'personal' });
  });

  it('surfaces the one-way downgrade rejection verbatim', async () => {
    const callSkill = vi.fn(async () => ({ error: 'storage-policy-downgrade-not-supported' }));
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'none' });
    expect(r).toEqual({ ok: false, error: 'storage-policy-downgrade-not-supported' });
  });

  it('surfaces the admin-only rejection', async () => {
    const callSkill = vi.fn(async () => ({ error: 'admin-only' }));
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'shared', groupPodUri: 'https://pod/' });
    expect(r).toEqual({ ok: false, error: 'admin-only' });
  });

  it('guards missing inputs', async () => {
    expect(await pushCircleStoragePolicy({})).toEqual({ ok: false, error: 'no-callskill' });
    expect(await pushCircleStoragePolicy({ callSkill: vi.fn() })).toEqual({ ok: false, error: 'groupId required' });
  });

  it('catches a throwing callSkill', async () => {
    const callSkill = vi.fn(async () => { throw new Error('boom'); });
    const r = await pushCircleStoragePolicy({ callSkill, circleId: 'c-1', pod: 'shared' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/storage-policy-write-failed:boom/);
  });
});

describe('loadCircleStoragePod', () => {
  it('reads stoop.getCircleStoragePolicy and hydrates the pod axis', async () => {
    const callSkill = vi.fn(async () => ({ policy: 'personal', groupPodUri: null }));
    const r = await loadCircleStoragePod({ callSkill, circleId: 'c-1' });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getCircleStoragePolicy', { groupId: 'c-1' });
    expect(r).toEqual({ pod: 'personal', groupPodUri: null });
  });

  it('returns null on error / missing inputs (form keeps its local value)', async () => {
    expect(await loadCircleStoragePod({})).toBeNull();
    expect(await loadCircleStoragePod({ callSkill: vi.fn(async () => ({ error: 'groupId required' })), circleId: 'c-1' })).toBeNull();
    expect(await loadCircleStoragePod({ callSkill: vi.fn(async () => { throw new Error('x'); }), circleId: 'c-1' })).toBeNull();
  });
});
