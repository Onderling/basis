// circlePodCustody — the shared per-circle pod custody-resolution extracted from the web shell. These
// unit tests cover the factory over injected deps directly (the shell round-trip tests exercise it in
// situ); together they guard the seal-or-refuse + no-pod-inert contracts against a regression.
import { describe, it, expect, vi } from 'vitest';
import { createCirclePodCustody } from '../../src/v2/circlePodCustody.js';

// A minimal PodClient shape (podStorageBackend requires read/write/list).
const podClient = { read: async () => null, write: async () => {}, list: async () => [], remove: async () => {} };
const ensureCirclePod = vi.fn(async () => ({ podClient }));

// A backend that records the seal/write it was asked to do, so we can assert seal-or-refuse.
function makeDeps({ pod = 'shared', storagePosture = 'p2', strategy = { seal: (x) => `sealed:${x}`, open: (x) => x } } = {}) {
  return {
    ensureCirclePod,
    policyFor:       async () => ({ pod, storagePosture }),
    sealStrategyFor: async () => strategy,
  };
}

describe('createCirclePodCustody — construction', () => {
  it('throws without the required injected deps', () => {
    expect(() => createCirclePodCustody({})).toThrow(/ensureCirclePod/);
    expect(() => createCirclePodCustody({ ensureCirclePod })).toThrow(/policyFor/);
    expect(() => createCirclePodCustody({ ensureCirclePod, policyFor: async () => ({}) })).toThrow(/sealStrategyFor/);
  });
});

describe('createCirclePodCustody — resolution', () => {
  it('a no-pod circle resolves to null — the seam stays inert (fan-out-full)', async () => {
    const { resolveCirclePodCustody } = createCirclePodCustody(makeDeps({ pod: 'none' }));
    expect(await resolveCirclePodCustody('c1')).toBeNull();
  });

  it('a pod-backed circle resolves {backend, sealed, strategy}; p2/p3 are sealed', async () => {
    const { resolveCirclePodCustody } = createCirclePodCustody(makeDeps({ pod: 'shared', storagePosture: 'p2' }));
    const c = await resolveCirclePodCustody('c1');
    expect(c).toBeTruthy();
    expect(c.sealed).toBe(true);
    expect(typeof c.strategy.seal).toBe('function');
  });

  it('a p0 (trusted-host) circle is pod-backed but NOT sealed', async () => {
    const { resolveCirclePodCustody } = createCirclePodCustody(makeDeps({ pod: 'shared', storagePosture: 'p0', strategy: null }));
    const c = await resolveCirclePodCustody('c1');
    expect(c.sealed).toBe(false);
  });

  it('the data-move branch follows the policy', async () => {
    const { circleSendDataMove } = createCirclePodCustody(makeDeps({ pod: 'shared' }));
    expect(await circleSendDataMove('c1')).toBe('pod-signal');
    const none = createCirclePodCustody(makeDeps({ pod: 'none' }));
    expect(await none.circleSendDataMove('c1')).toBe('fan-out-full');
  });
});

describe('createCirclePodCustody — seal-or-refuse write', () => {
  it('a no-pod circle write THROWS (→ the caller degrades to fan-out-full)', async () => {
    const { circlePodWrite } = createCirclePodCustody(makeDeps({ pod: 'none' }));
    await expect(circlePodWrite('c1', { body: 'x' })).rejects.toThrow(/no shared pod/);
  });

  it('a SEALED circle with NO group key REFUSES to write plaintext', async () => {
    const { circlePodWrite } = createCirclePodCustody(makeDeps({ pod: 'shared', storagePosture: 'p2', strategy: null }));
    await expect(circlePodWrite('c1', { body: 'x' })).rejects.toThrow(/refusing to write plaintext/);
  });

  it('a readSince on a sealed circle with no key falls back to empty (not a throw)', async () => {
    const { circlePodReadSince } = createCirclePodCustody(makeDeps({ pod: 'shared', storagePosture: 'p2', strategy: null }));
    expect(await circlePodReadSince('c1', {})).toEqual({ items: [] });
  });
});
