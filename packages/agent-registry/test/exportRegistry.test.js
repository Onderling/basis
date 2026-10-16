// Identity step 5A — export/import the profile set as an encrypted, storage-agnostic artifact.
import { describe, it, expect } from 'vitest';
import { Bootstrap, mintProfileId } from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createAgentRegistry } from '../src/AgentRegistry.js';
import {
  exportProfileRegistry, importProfileRegistry, restoreProfilesInto,
  createProfile, profilePubKey, own,
} from '../index.js';

const LIGHT = { m: 8, t: 1, p: 1 };   // fast argon2 for tests (prod cost is much higher)
const mkReg = () => createAgentRegistry({
  pseudoPod: createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'd' }),
  deviceId: 'd',
});

// a second persona: its id is minted, never a name
const WORK = mintProfileId();

describe('profile registry export (step 5A)', () => {
  it('round-trips the owner root + profile set through an encrypted artifact (pod-less recovery)', async () => {
    const root = Bootstrap.create().bootstrap;
    const reg = mkReg();
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default', properties: { relay: own('wss://home') } });
    await createProfile({ registry: reg, ownerRoot: root, profileId: WORK });

    const sealed = await exportProfileRegistry({ ownerRoot: root, registry: reg, passphrase: 'export-pw', argonOpts: LIGHT });
    expect(sealed).toBeInstanceOf(Uint8Array);
    expect(sealed.length).toBeGreaterThan(0);

    // pod-less recovery: from JUST the file + the passphrase.
    const { ownerRoot: restoredRoot, registry: snapshot } = await importProfileRegistry({ sealed, passphrase: 'export-pw', argonOpts: LIGHT });
    // the recovered owner root re-derives the SAME profile keys
    expect(profilePubKey(restoredRoot, 'default')).toBe(profilePubKey(root, 'default'));
    expect(profilePubKey(restoredRoot, WORK)).toBe(profilePubKey(root, WORK));
    // the snapshot carries the profiles + their (non-derivable) properties
    expect(snapshot.agents.map((a) => a.agentId).sort()).toEqual(['default', WORK].sort());
    expect(snapshot.agents.find((a) => a.agentId === 'default').properties.relay).toEqual({ mode: 'own', value: 'wss://home' });

    // restore into a FRESH registry (new device, no pod)
    const fresh = mkReg();
    expect(await restoreProfilesInto(fresh, snapshot)).toBe(2);
    expect((await fresh.lookup('default')).pubKey).toBe(profilePubKey(root, 'default'));
  });

  it('a WRONG passphrase fails to open (no silent garbage)', async () => {
    const root = Bootstrap.create().bootstrap;
    const reg = mkReg();
    await createProfile({ registry: reg, ownerRoot: root, profileId: 'default' });
    const sealed = await exportProfileRegistry({ ownerRoot: root, registry: reg, passphrase: 'right', argonOpts: LIGHT });
    await expect(importProfileRegistry({ sealed, passphrase: 'WRONG', argonOpts: LIGHT })).rejects.toThrow();
  });

  it('validates inputs', async () => {
    const reg = mkReg();
    await expect(exportProfileRegistry({ registry: reg, passphrase: 'x', argonOpts: LIGHT })).rejects.toThrow(/ownerRoot/);
    await expect(exportProfileRegistry({ ownerRoot: Bootstrap.create().bootstrap, registry: reg, argonOpts: LIGHT })).rejects.toThrow(/passphrase/);
    await expect(importProfileRegistry({ passphrase: 'x' })).rejects.toThrow(/sealed/);
  });
});
