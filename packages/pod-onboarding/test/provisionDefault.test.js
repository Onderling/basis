/**
 * provisionDefault — orchestration coverage.
 *
 * Uses a fake `podProvisioner` to verify call sequence + payload
 * shapes without touching real Solid servers.
 */

import { describe, it, expect } from 'vitest';
import { generateMnemonic }     from '@onderling/core';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { provisionDefault }     from '../src/provisionDefault.js';

const ANNE_POD   = 'https://anne.pod';
const ANNE_WEBID = 'https://anne.pod/profile/card#me';

function fakeProvisioner({ podUri = ANNE_POD, webidUri = ANNE_WEBID } = {}) {
  const calls = [];
  const fetch = () => Promise.resolve();
  return {
    calls,
    async createPod(args) {
      calls.push({ name: 'createPod', args });
      return { podUri, webidUri, fetch };
    },
    async createContainer(args) { calls.push({ name: 'createContainer', args }); },
    async setAcp(args)          { calls.push({ name: 'setAcp', args }); },
    async putResource(args)     { calls.push({ name: 'putResource', args }); },
    async patchWebidProfile(args) { calls.push({ name: 'patchWebidProfile', args }); },
  };
}

function mkPseudoPod(deviceId = 'laptop-anne') {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
}

describe('provisionDefault — input validation', () => {
  it('requires pseudoPod', async () => {
    await expect(provisionDefault({
      podProvisioner: fakeProvisioner(),
      mnemonic: 'a a a a a a a a a a a a',
      agentInfo: { deviceId: 'd', agentUri: 'a' },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('requires podProvisioner', async () => {
    await expect(provisionDefault({
      pseudoPod: mkPseudoPod(),
      mnemonic: 'a a a a a a a a a a a a',
      agentInfo: { deviceId: 'd', agentUri: 'a' },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('requires agentInfo.deviceId + agentUri', async () => {
    await expect(provisionDefault({
      pseudoPod:      mkPseudoPod(),
      podProvisioner: fakeProvisioner(),
      mnemonic:       generateMnemonic(),
      agentInfo:      { deviceId: 'd' },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('requires mnemonic OR pre-built identity', async () => {
    await expect(provisionDefault({
      pseudoPod:      mkPseudoPod(),
      podProvisioner: fakeProvisioner(),
      agentInfo:      { deviceId: 'd', agentUri: 'a' },
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('provisionDefault — happy path', () => {
  it('orchestrates the full provision flow', async () => {
    const pseudoPod = mkPseudoPod();
    const prov = fakeProvisioner();
    const mnemonic = generateMnemonic();

    const result = await provisionDefault({
      oidcProvider:    'https://inrupt.net',
      mnemonic,
      pseudoPod,
      podProvisioner:  prov,
      agentInfo: {
        deviceId:    'laptop-anne',
        agentUri:    'agent://anne/laptop',
        displayName: 'Anne',
      },
    });

    expect(result.podUri).toBe(ANNE_POD);
    expect(result.webidUri).toBe(ANNE_WEBID);
    expect(result.pointers.storage).toBe('https://anne.pod/');
    expect(result.storageMapping.mappings['private/*']).toBe('https://anne.pod/private/');
    expect(result.agentRegistryEntry.agents).toHaveLength(1);
    expect(result.identity).toBeTruthy();
    expect(result.mnemonic).toBe(mnemonic);

    // Call sequence: createPod → 3× createContainer → 3× setAcp →
    //                 2× putResource → patchWebidProfile.
    const names = prov.calls.map(c => c.name);
    expect(names[0]).toBe('createPod');
    expect(names.filter(n => n === 'createContainer')).toHaveLength(3);
    expect(names.filter(n => n === 'setAcp')).toHaveLength(3);
    expect(names.filter(n => n === 'putResource')).toHaveLength(2);
    expect(names[names.length - 1]).toBe('patchWebidProfile');

    // Containers in the right order.
    const containerUris = prov.calls
      .filter(c => c.name === 'createContainer')
      .map(c => c.args.uri);
    expect(containerUris).toEqual([
      'https://anne.pod/private/',
      'https://anne.pod/sharing/',
      'https://anne.pod/sharing/public/',
    ]);

    // ACPs tagged with the right webid.
    const acpCalls = prov.calls.filter(c => c.name === 'setAcp');
    for (const c of acpCalls) {
      const ownerMatcher = c.args.acp.policies.find(p => p.matchers.some(m => m.agent === ANNE_WEBID));
      expect(ownerMatcher).toBeTruthy();
    }

    // Pod resources written to the expected URIs.
    const putUris = prov.calls.filter(c => c.name === 'putResource').map(c => c.args.uri);
    expect(putUris).toEqual([
      'https://anne.pod/private/storage-mapping',
      'https://anne.pod/private/agent-registry',
    ]);

    // Local mirror copies present.
    expect((await pseudoPod.read('pseudo-pod://laptop-anne/private/storage-mapping'))?.bytes)
      .toMatchObject({ version: 2, mappings: expect.any(Object) });
    expect((await pseudoPod.read('pseudo-pod://laptop-anne/private/agent-registry'))?.bytes)
      .toMatchObject({ version: 1, agents: expect.any(Array) });

    // WebID patch shape.
    const patchCall = prov.calls.find(c => c.name === 'patchWebidProfile');
    expect(patchCall.args.webidUri).toBe(ANNE_WEBID);
    expect(patchCall.args.pointers.storageMappingUri).toBe('https://anne.pod/private/storage-mapping');
    expect(patchCall.args.predicates.storageMappingUri).toMatch(/onderling\.org/);
  });

  it('accepts a pre-built identity (no mnemonic)', async () => {
    const pseudoPod = mkPseudoPod('d');
    const prov = fakeProvisioner();
    const { AgentIdentity } = await import('@onderling/core');
    const { VaultMemory }   = await import('@onderling/vault');
    const vault = new VaultMemory();
    const identity = await AgentIdentity.fromMnemonic(generateMnemonic(), vault);

    const result = await provisionDefault({
      identity,
      pseudoPod,
      podProvisioner: prov,
      agentInfo: { deviceId: 'd', agentUri: 'agent://x' },
    });
    expect(result.identity).toBe(identity);
    expect(result.mnemonic).toBeUndefined();
  });

  it('throws PROVISIONER_FAILED on bad createPod return', async () => {
    const badProv = {
      ...fakeProvisioner(),
      async createPod() { return { /* missing podUri/webidUri */ }; },
    };
    await expect(provisionDefault({
      pseudoPod:      mkPseudoPod(),
      podProvisioner: badProv,
      mnemonic:       generateMnemonic(),
      agentInfo:      { deviceId: 'd', agentUri: 'a' },
    })).rejects.toMatchObject({ code: 'PROVISIONER_FAILED' });
  });

  it('tolerates a provisioner without optional methods', async () => {
    // Only createPod + putResource — the bare minimum.
    const minimal = {
      async createPod() { return { podUri: ANNE_POD, webidUri: ANNE_WEBID, fetch: () => {} }; },
      async putResource() {},
    };
    const result = await provisionDefault({
      pseudoPod:      mkPseudoPod('d'),
      podProvisioner: minimal,
      mnemonic:       generateMnemonic(),
      agentInfo:      { deviceId: 'd', agentUri: 'a' },
    });
    expect(result.podUri).toBe(ANNE_POD);
  });
});
