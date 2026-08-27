/**
 * initialResources — storage-mapping + agent-registry + WebID pointer builders.
 */

import { describe, it, expect } from 'vitest';
import {
  buildInitialStorageMapping,
  buildInitialAgentRegistry,
  buildWebidPointers,
  pointerPredicates,
} from '../src/initialResources.js';

const ANNE_POD = 'https://anne.pod';
const DEVICE   = 'laptop-anne';

const AGENT = {
  deviceId:    DEVICE,
  agentUri:    'agent://anne/laptop',
  pubKey:      'base64-pubkey-blob',
  displayName: 'Anne',
  capabilities: ['stoop', 'tasks'],
};

describe('buildInitialStorageMapping', () => {
  it('produces a v2 config seeded with the default policy', () => {
    const sm = buildInitialStorageMapping({ podUri: ANNE_POD, deviceId: DEVICE });
    expect(sm.version).toBe(2);
    expect(sm.defaultPolicy).toBe('one-pod');
    expect(sm.mappings['private/*']).toBe('https://anne.pod/private/');
    expect(sm.mappings['sharing/*']).toBe('https://anne.pod/sharing/');
    expect(sm.mappings['sharing/profile-public'])
      .toBe('https://anne.pod/sharing/public/profile-card');
    expect(sm.circlePolicies).toEqual({});
    expect(sm.circlePolicyDefault).toEqual({
      policy:      'shared',
      groupPodUri: 'https://anne.pod',
    });
    expect(typeof sm.updatedAt).toBe('string');
  });

  it('rejects missing podUri', () => {
    expect(() => buildInitialStorageMapping({ deviceId: 'd' })).toThrow(/podUri/);
  });

  it('rejects missing deviceId', () => {
    expect(() => buildInitialStorageMapping({ podUri: 'https://x.pod' })).toThrow(/deviceId/);
  });
});

describe('buildInitialAgentRegistry', () => {
  it('seeds with this agent as the sole entry', () => {
    const reg = buildInitialAgentRegistry({ agentInfo: AGENT, podUri: ANNE_POD });
    expect(reg.version).toBe(1);
    expect(reg.podUri).toBe(ANNE_POD);
    expect(reg.agents).toHaveLength(1);
    // Seed shape matches @onderling/agent-registry expectations
    // (agentId, name, signedAt) — substrate composition fix Phase 52.10.
    expect(reg.agents[0]).toMatchObject({
      agentId:     DEVICE,
      deviceId:    DEVICE,
      agentUri:    'agent://anne/laptop',
      pubKey:      'base64-pubkey-blob',
      name:        'Anne',
      role:        'device',
      capabilities: ['stoop', 'tasks'],
      revokedAt:   null,
    });
    expect(typeof reg.agents[0].signedAt).toBe('string');
  });

  it('tolerates missing displayName + capabilities', () => {
    const reg = buildInitialAgentRegistry({
      agentInfo: { deviceId: 'd', agentUri: 'a', pubKey: 'k' },
      podUri:    ANNE_POD,
    });
    expect(reg.agents[0].name).toBe(null);
    expect(reg.agents[0].capabilities).toEqual([]);
  });

  it('rejects missing required agentInfo fields', () => {
    expect(() => buildInitialAgentRegistry({
      agentInfo: { deviceId: 'd' },   // missing agentUri + pubKey
      podUri:    ANNE_POD,
    })).toThrow();
  });
});

describe('buildWebidPointers', () => {
  it('returns the four canonical pointers + frozen', () => {
    const p = buildWebidPointers({ podUri: ANNE_POD });
    expect(p).toEqual({
      storage:           'https://anne.pod/',
      storageMappingUri: 'https://anne.pod/private/storage-mapping',
      agentRegistryUri:  'https://anne.pod/private/agent-registry',
      auditLogUri:       'https://anne.pod/private/audit-log',
    });
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('tolerates pod URIs with trailing slash', () => {
    const p = buildWebidPointers({ podUri: 'https://anne.pod/' });
    expect(p.storage).toBe('https://anne.pod/');
    expect(p.storageMappingUri).toBe('https://anne.pod/private/storage-mapping');
  });

  it('rejects missing podUri', () => {
    expect(() => buildWebidPointers({})).toThrow(/podUri/);
  });
});

describe('pointerPredicates', () => {
  it('returns the predicate IRIs for each pointer', () => {
    const preds = pointerPredicates();
    expect(preds.storage).toBe('http://www.w3.org/ns/solid/terms#storage');
    expect(preds.storageMappingUri).toMatch(/^https:\/\/onderling\.org\/ns#/);
    expect(preds.agentRegistryUri).toMatch(/^https:\/\/onderling\.org\/ns#/);
    expect(preds.auditLogUri).toMatch(/^https:\/\/onderling\.org\/ns#/);
  });
});
