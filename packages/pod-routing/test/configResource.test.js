/**
 * configResource — read/write + URI derivation.
 *
 * Backed by a real in-memory pseudo-pod so the wire shape matches
 * production.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import {
  configResourceUri,
  readConfig,
  writeConfig,
  CONFIG_VERSION,
} from '../src/configResource.js';

function mkPod(deviceId = 'd1') {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId,
  });
}

describe('configResourceUri', () => {
  it('returns the pseudo-pod URI in V0', () => {
    expect(configResourceUri({ deviceId: 'laptop-anne', anchorPodUri: null }))
      .toBe('pseudo-pod://laptop-anne/private/storage-mapping');
  });

  it('returns the pseudo-pod URI even when a pod is attached (V0 limitation)', () => {
    expect(configResourceUri({ deviceId: 'd', anchorPodUri: 'https://anne.pod' }))
      .toBe('pseudo-pod://d/private/storage-mapping');
  });

  it('throws on missing deviceId', () => {
    expect(() => configResourceUri({}))
      .toThrow(/deviceId/);
  });
});

describe('readConfig / writeConfig', () => {
  it('round-trips a config object through the pseudo-pod', async () => {
    const pseudoPod = mkPod('d1');
    const uri = configResourceUri({ deviceId: 'd1' });
    await writeConfig({
      pseudoPod,
      uri,
      config: {
        version: CONFIG_VERSION,
        mappings:    { 'sharing/*': 'pseudo-pod://d1/sharing/' },
        circlePolicies: { 'circle-a': { policy: 'none' } },
      },
    });
    const got = await readConfig({ pseudoPod, uri });
    expect(got).toBeTruthy();
    expect(got.version).toBe(CONFIG_VERSION);
    expect(got.mappings).toEqual({ 'sharing/*': 'pseudo-pod://d1/sharing/' });
    expect(got.circlePolicies).toEqual({ 'circle-a': { policy: 'none' } });
    expect(typeof got.updatedAt).toBe('string');
  });

  it('returns null when the resource does not exist', async () => {
    const pseudoPod = mkPod();
    const got = await readConfig({
      pseudoPod,
      uri: 'pseudo-pod://d1/private/storage-mapping',
    });
    expect(got).toBe(null);
  });

  it('parses JSON string payloads', async () => {
    const pseudoPod = mkPod();
    const uri = 'pseudo-pod://d1/private/storage-mapping';
    await pseudoPod.write(uri, JSON.stringify({
      version:  CONFIG_VERSION,
      mappings: { 'private/*': '/x/' },
    }));
    const got = await readConfig({ pseudoPod, uri });
    expect(got?.mappings).toEqual({ 'private/*': '/x/' });
  });

  it('throws INVALID_CONFIG on non-JSON / non-object payloads', async () => {
    const pseudoPod = mkPod();
    const uri = 'pseudo-pod://d1/private/storage-mapping';
    await pseudoPod.write(uri, 42);
    await expect(readConfig({ pseudoPod, uri }))
      .rejects.toMatchObject({ code: 'INVALID_CONFIG' });
  });

  it('preserves updatedAt when supplied', async () => {
    const pseudoPod = mkPod();
    const uri = 'pseudo-pod://d1/private/storage-mapping';
    const fixed = '2026-05-11T10:00:00.000Z';
    await writeConfig({
      pseudoPod,
      uri,
      config: { version: CONFIG_VERSION, mappings: {}, circlePolicies: {}, updatedAt: fixed },
    });
    const got = await readConfig({ pseudoPod, uri });
    expect(got?.updatedAt).toBe(fixed);
  });

  it('frozen normalised config cannot be mutated', async () => {
    const pseudoPod = mkPod();
    const uri = 'pseudo-pod://d1/private/storage-mapping';
    await writeConfig({
      pseudoPod,
      uri,
      config: { version: CONFIG_VERSION, mappings: { 'a/*': '/x/' }, circlePolicies: {} },
    });
    const got = await readConfig({ pseudoPod, uri });
    expect(Object.isFrozen(got)).toBe(true);
    expect(Object.isFrozen(got.mappings)).toBe(true);
    expect(Object.isFrozen(got.circlePolicies)).toBe(true);
  });
});
