// Identity step 2 — root-derived profile creation: reproducible keys + registry entry.
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import { createProfile, profilePubKey, profileCircleAddress, own } from '../index.js';

const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd1' }),
  deviceId: 'd1',
});

describe('createProfile — root-derived profile entries', () => {
  it('is reproducible: same owner root + profileId → same pubKey (recovery on any device)', () => {
    const { mnemonic } = Bootstrap.create();
    const pk1 = profilePubKey(Bootstrap.fromMnemonic(mnemonic), 'default');
    const pk2 = profilePubKey(Bootstrap.fromMnemonic(mnemonic), 'default');   // "another device"
    expect(pk1).toBe(pk2);
    expect(typeof pk1).toBe('string');
  });

  it('different profileId → different key; different root → different key', () => {
    const root = Bootstrap.create().bootstrap;
    expect(profilePubKey(root, 'default')).not.toBe(profilePubKey(root, 'home-device'));
    expect(profilePubKey(root, 'default')).not.toBe(profilePubKey(Bootstrap.create().bootstrap, 'default'));
  });

  it('registers a profile entry with the derived key + owner fingerprint + properties', async () => {
    const reg = mkReg();
    const root = Bootstrap.create().bootstrap;
    const { pubKey } = await createProfile({
      registry: reg, ownerRoot: root, profileId: 'default', properties: { relay: own('wss://r') },
    });
    expect(pubKey).toBe(profilePubKey(root, 'default'));
    const stored = await reg.lookup('default');
    expect(stored.pubKey).toBe(pubKey);
    expect(stored.ownerFingerprint).toBe(root.fingerprint());
    expect(stored.role).toBe('profile');
    expect(stored.properties.relay).toEqual({ mode: 'own', value: 'wss://r' });
  });

  it('two profiles from one root share the owner fingerprint but have distinct keys', async () => {
    const reg = mkReg();
    const root = Bootstrap.create().bootstrap;
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default' });
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'work' });
    const a = await reg.lookup('default');
    const b = await reg.lookup('work');
    expect(a.ownerFingerprint).toBe(b.ownerFingerprint);   // same account
    expect(a.pubKey).not.toBe(b.pubKey);                    // distinct per-profile keys
  });

  it('validates inputs', async () => {
    await expect(createProfile({ registry: mkReg() })).rejects.toThrow(/ownerRoot/);
    await expect(createProfile({ ownerRoot: Bootstrap.create().bootstrap })).rejects.toThrow(/registry/);
  });

  it('profileCircleAddress (step 3): reproducible, distinct per circle, != the profile pubKey', () => {
    const root = Bootstrap.create().bootstrap;
    const a = profileCircleAddress(root, 'default', 'circle-42');
    expect(a).toBe(profileCircleAddress(root, 'default', 'circle-42'));           // reproducible (recovery)
    expect(a).not.toBe(profileCircleAddress(root, 'default', 'werk-7'));         // unlinkable per circle
    expect(a).not.toBe(profilePubKey(root, 'default'));                          // circle address != profile key
  });
});
