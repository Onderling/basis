// Identity step 4 — materialize a profile on a device (from the owner root or a delegated seed).
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '../../vault/src/VaultMemory.js';
import { Bootstrap, AgentIdentity } from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { loadProfile, createProfile, profilePubKey, profileCircleAddress } from '../index.js';

const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
});

describe('loadProfile — materialize a profile on a device (step 4)', () => {
  it('loads from the owner root: identity = the profile, persisted + restorable from the device vault', async () => {
    const root = Bootstrap.create().bootstrap;
    const vault = new VaultMemory();
    const loaded = await loadProfile({ ownerRoot: root, profileId: 'default', vault });
    expect(loaded.pubKey).toBe(profilePubKey(root, 'default'));
    expect(await vault.get('agent-privkey')).toBeTruthy();                    // materialised locally
    expect((await AgentIdentity.restore(vault)).pubKey).toBe(loaded.pubKey);  // survives a reload
  });

  it('loads from a DELEGATED profile seed (no owner root) — a gadget with just its one profile', async () => {
    const root = Bootstrap.create().bootstrap;
    const seed = root.deriveAgentSeed('home');   // the only material the gadget was given
    const loaded = await loadProfile({ profileSeed: seed, profileId: 'home', vault: new VaultMemory() });
    expect(loaded.pubKey).toBe(profilePubKey(root, 'home'));
  });

  it('exposes per-circle addresses (unlinkable) matching the derivation', async () => {
    const root = Bootstrap.create().bootstrap;
    const loaded = await loadProfile({ ownerRoot: root, profileId: 'default', vault: new VaultMemory() });
    expect(loaded.circleAddress('circle-42')).toBe(profileCircleAddress(root, 'default', 'circle-42'));
    expect(loaded.circleAddress('circle-42')).not.toBe(loaded.circleAddress('werk-7'));   // per-circle distinct
    expect(loaded.circleAddress('circle-42')).not.toBe(loaded.pubKey);                    // != the profile key
    expect(loaded.circleSeed('circle-42')).toBeInstanceOf(Uint8Array);
  });

  it('verifies against the registry: loading a createProfile-registered profile agrees', async () => {
    const reg = mkReg();
    const root = Bootstrap.create().bootstrap;
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default' });
    const loaded = await loadProfile({ ownerRoot: root, profileId: 'default', vault: new VaultMemory(), registry: reg });
    expect(loaded.pubKey).toBe((await reg.lookup('default')).pubKey);
  });

  it('throws if the derived key does NOT match the registered profile (integrity)', async () => {
    const reg = mkReg();
    await reg.register({ agentId: 'default', pubKey: 'WRONG-KEY', agentUri: 'u' });
    await expect(loadProfile({ ownerRoot: Bootstrap.create().bootstrap, profileId: 'default', vault: new VaultMemory(), registry: reg }))
      .rejects.toThrow(/does not match/);
  });

  it('validates inputs', async () => {
    await expect(loadProfile({ vault: new VaultMemory() })).rejects.toThrow(/profileSeed/);
    await expect(loadProfile({ ownerRoot: Bootstrap.create().bootstrap, profileId: 'x' })).rejects.toThrow(/vault/);
  });

  it('circleIdentity(circleId): the per-circle signing identity has the circle address as its pubKey', async () => {
    const loaded = await loadProfile({ ownerRoot: Bootstrap.create().bootstrap, profileId: 'default', vault: new VaultMemory() });
    const cid = await loaded.circleIdentity('circle-42', new VaultMemory());
    expect(cid.pubKey).toBe(loaded.circleAddress('circle-42'));
  });
});
