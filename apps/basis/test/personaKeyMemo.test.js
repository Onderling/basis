/**
 * A persona runtime derives each circle address and its person key's pubKey ONCE, and keeps them on itself.
 *
 * Measured on a phone (Hermes, 2026-10-23): the same per-circle address and person-key pubKey were re-derived dozens
 * of times during boot — each a hash plus an Ed25519 keypair in pure JS. The memo lives on the runtime instance (never
 * module-level, never keyed by seed bytes), is bounded, and a person-key rotation — which replaces the key record —
 * derives afresh.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultMemory } from '@onderling/vault';

const counts = vi.hoisted(() => ({ address: 0, personKey: 0 }));
vi.mock('@onderling/core', async (importOriginal) => {
  const real = await importOriginal();
  return {
    ...real,
    deriveCircleAddress: (...a) => { counts.address += 1; return real.deriveCircleAddress(...a); },
    personKeyPubKeyB64: (...a) => { counts.personKey += 1; return real.personKeyPubKeyB64(...a); },
  };
});

const core = await import('@onderling/core');
const { createPersonaRuntime } = await import('../src/core/agent/personaRuntime.js');

const runtime = (root, profileId = 'default') =>
  createPersonaRuntime({ profileId, ownerRoot: root, custody: { mode: 'root' }, chatVault: new VaultMemory() });

beforeEach(() => { counts.address = 0; counts.personKey = 0; });

describe('the persona runtime memoises its own derivations', () => {
  it('a circle address is derived once per circle, and equals the uncached derivation', async () => {
    const root = core.Bootstrap.create().bootstrap;
    const p = await runtime(root);
    counts.address = 0;
    const first = p.circleAddressFor('c-1');
    for (let i = 0; i < 20; i += 1) expect(p.circleAddressFor('c-1')).toBe(first);
    expect(p.circleAddressFor('c-2')).not.toBe(first);
    expect(counts.address).toBe(2);
    expect(first).toBe(core.deriveCircleAddress(p.deviceDerivationSeed, 'c-1'));
  });

  it('two runtimes never share an entry: each derives its own', async () => {
    const a = await runtime(core.Bootstrap.create().bootstrap);
    const b = await runtime(core.Bootstrap.create().bootstrap);
    expect(a.circleAddressFor('c-1')).not.toBe(b.circleAddressFor('c-1'));
    expect(b.circleAddressFor('c-1')).toBe(core.deriveCircleAddress(b.deviceDerivationSeed, 'c-1'));
  });

  it('the person key pubKey is derived once per key record, and a rotation derives afresh', async () => {
    const p = await runtime(core.Bootstrap.create().bootstrap);
    const v1 = p.initialPersonKey;
    counts.personKey = 0;
    const pub1 = p.personKeyPubOf(v1);
    for (let i = 0; i < 20; i += 1) expect(p.personKeyPubOf(v1)).toBe(pub1);
    expect(counts.personKey).toBe(1);
    expect(pub1).toBe(core.personKeyPubKeyB64(v1.seed));

    const v2 = { version: 2, seed: core.derivePersonKeySeed(p.profileSeed, 2) };
    const pub2 = p.personKeyPubOf(v2);
    expect(pub2).not.toBe(pub1);
    expect(pub2).toBe(core.personKeyPubKeyB64(v2.seed));
    expect(p.personKeyPubOf(null)).toBe(null);
  });
});
