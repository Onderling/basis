/**
 * settingsPodMedium (#36 pod-sync) — the self-sealed, path-mapped pod inner for the register's settings
 * store. These cross the SEAL + PATH-MAP seams against an in-memory pod backend (no live pod): a write is
 * sealed at rest and addressed pod-relative; only THIS user's key opens it.
 *
 * The seal-to-self strategy is derived from a network identity (owner-root → deriveAgentSeed in production),
 * so the CROSS-DEVICE guarantee is the load-bearing one: two identities derived from the SAME seed build
 * interoperable strategies (a settings write on one device opens on another); a different seed cannot open.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { sealingKeyPairFromNetworkKey, recipientStrategy } from '@onderling/pod-client';
import { createSettingsPodMedium } from '../../src/v2/settingsPodMedium.js';
import { settingsSealStrategyForIdentity } from '../../src/v2/sharedCopyOpener.js';

/** A minimal SolidPodSource-shaped in-memory backend: read/write/delete/list over a Map. */
function memPodSource() {
  const m = new Map();
  return {
    async read(uri)  { if (!m.has(uri)) { const e = new Error('Not Found'); e.status = 404; throw e; } return { content: m.get(uri) }; },
    async write(uri, content) { m.set(uri, String(content)); },
    async delete(uri) { m.delete(uri); },
    async list(prefix) { return [...m.keys()].filter((k) => k.startsWith(prefix)); },
    _raw: m,
  };
}

const seedB64 = (fill) => Buffer.from(new Uint8Array(32).fill(fill)).toString('base64url');
/** A seal-to-self strategy from a 32-byte network seed (stands in for the owner-root-derived agent key). */
const strategyFromSeed = (fill) => {
  const kp = sealingKeyPairFromNetworkKey(seedB64(fill));
  return recipientStrategy({ recipients: [kp.publicKey], privateKey: kp.privateKey });
};

const PODROOT = 'https://alice.pod/';
const PATH    = 'mem://basis/settings/shared.json';

describe('settingsPodMedium — self-sealed, path-mapped pod inner for the register (#36)', () => {
  it('maps mem:// logical keys → pod-relative URIs (strips the scheme)', async () => {
    const pod = memPodSource();
    const medium = await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(1), podSource: pod });
    await medium.write(PATH, JSON.stringify({ 'nearby.ask.defaultTtlMs': 600000 }));
    expect([...pod._raw.keys()]).toContain('basis/settings/shared.json'); // pod-relative
    expect(pod._raw.has(PATH)).toBe(false);                               // never the mem:// logical key
  });

  it('seals at rest — the raw pod bytes are an fp1 envelope, not the plaintext value', async () => {
    const pod = memPodSource();
    const medium = await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(1), podSource: pod });
    await medium.write(PATH, JSON.stringify({ 'nearby.ask.defaultTtlMs': 1234567 }));
    const raw = pod._raw.get('basis/settings/shared.json');
    expect(raw.startsWith('fp1:')).toBe(true);
    expect(raw).not.toContain('1234567');            // the value is NOT in cleartext on the pod
  });

  it('CROSS-DEVICE: a write sealed under one seed opens under the SAME seed, and a DIFFERENT seed cannot', async () => {
    const pod = memPodSource();
    const deviceA = await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(9), podSource: pod });
    await deviceA.write(PATH, JSON.stringify({ x: 42 }));

    // Device B of the SAME user (same owner-root seed → same key) opens A's write.
    const deviceB = await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(9), podSource: pod });
    expect(JSON.parse(await deviceB.read(PATH))).toEqual({ x: 42 });

    // A different user's key cannot open it — deny, never a plaintext/ciphertext leak.
    const stranger = await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(3), podSource: pod });
    await expect(stranger.read(PATH)).rejects.toBeTruthy();
  });

  it('the identity bridge is cross-device: two AgentIdentity from the SAME seed build interoperable strategies', async () => {
    const seed = new Uint8Array(32).fill(5);
    const idA = await AgentIdentity.fromSeed(seed, new VaultMemory());
    const idB = await AgentIdentity.fromSeed(seed, new VaultMemory());   // a second device, same owner-root seed
    const stratA = settingsSealStrategyForIdentity(idA);
    const stratB = settingsSealStrategyForIdentity(idB);
    expect(stratA).toBeTruthy();

    const pod = memPodSource();
    const a = await createSettingsPodMedium({ podRoot: PODROOT, strategy: stratA, podSource: pod });
    await a.write(PATH, JSON.stringify({ retention: 30 }));
    const b = await createSettingsPodMedium({ podRoot: PODROOT, strategy: stratB, podSource: pod });
    expect(JSON.parse(await b.read(PATH))).toEqual({ retention: 30 });   // B opens A's settings

    // A different identity (different seed) is denied.
    const idOther = await AgentIdentity.fromSeed(new Uint8Array(32).fill(6), new VaultMemory());
    const other = await createSettingsPodMedium({ podRoot: PODROOT, strategy: settingsSealStrategyForIdentity(idOther), podSource: pod });
    await expect(other.read(PATH)).rejects.toBeTruthy();
  });

  it('list re-adds the mem:// scheme on read-back', async () => {
    const pod = memPodSource();
    const medium = await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(1), podSource: pod });
    await medium.write(PATH, JSON.stringify({ x: 1 }));
    const uris = await medium.list('mem://basis/settings/');
    expect(uris).toContain(PATH);
  });

  it('returns null (→ the store stays LOCAL) with no strategy or no pod', async () => {
    expect(await createSettingsPodMedium({ podRoot: PODROOT, podSource: memPodSource() })).toBe(null); // no strategy
    expect(await createSettingsPodMedium({ podRoot: PODROOT, strategy: strategyFromSeed(1) })).toBe(null); // no fetch/podSource
    expect(settingsSealStrategyForIdentity(null)).toBe(null);
    expect(settingsSealStrategyForIdentity({})).toBe(null);
  });
});
