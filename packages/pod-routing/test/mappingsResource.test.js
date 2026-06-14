/**
 * mappingsResource — folder scan + write/remove of downloadable extension
 * mappings (feedback-extension P2). Backed by a real in-memory pseudo-pod so
 * the wire shape (list/read/write/delete) matches production.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend } from '@canopy/pseudo-pod';
import {
  mappingsContainerUri,
  mappingResourceUri,
  validateMapping,
  loadMappings,
  writeMapping,
  removeMapping,
} from '../src/mappingsResource.js';

function mkPod(deviceId = 'd1') {
  return createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId });
}

const validMapping = (id = 'feedback-buurtplan') => ({
  id,
  version: '1',
  title: 'Buurtplan feedback',
  scope: 'circle',
  needs: ['call-LLM', 'write-pod'],
  ops: [
    { id: 'feedback', verb: 'submit', steps: [{ appOrigin: 'household', opId: 'addItem' }] },
  ],
  menus: [{ id: 'm1', buttons: [] }],
});

describe('URI derivation', () => {
  it('container + resource URIs', () => {
    expect(mappingsContainerUri({ deviceId: 'laptop' }))
      .toBe('pseudo-pod://laptop/private/mappings/');
    expect(mappingResourceUri({ deviceId: 'laptop', id: 'fb-1' }))
      .toBe('pseudo-pod://laptop/private/mappings/fb-1');
  });
  it('throws on missing deviceId / id', () => {
    expect(() => mappingsContainerUri({})).toThrow(/deviceId/);
    expect(() => mappingResourceUri({ deviceId: 'd' })).toThrow(/id/);
  });
});

describe('validateMapping', () => {
  it('accepts a valid mapping and freezes it', () => {
    const m = validateMapping(validMapping());
    expect(m.id).toBe('feedback-buurtplan');
    expect(m.scope).toBe('circle');
    expect(m.needs).toEqual(['call-LLM', 'write-pod']);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.ops)).toBe(true);
  });
  it('defaults scope→app and needs→[]', () => {
    const m = validateMapping({ id: 'x', ops: [{ id: 'a' }] });
    expect(m.scope).toBe('app');
    expect(m.needs).toEqual([]);
  });
  it('rejects missing id, non-array ops, and an op without id', () => {
    expect(() => validateMapping({ ops: [] })).toThrow(/id/);
    expect(() => validateMapping({ id: 'x', ops: 'nope' })).toThrow(/ops must be an array/);
    expect(() => validateMapping({ id: 'x', ops: [{ verb: 'q' }] })).toThrow(/string id/);
    expect(() => validateMapping(null)).toThrow(/object/);
  });
});

describe('write / load / remove round-trip', () => {
  it('writes two mappings and loads them both', async () => {
    const pseudoPod = mkPod('d1');
    await writeMapping({ pseudoPod, deviceId: 'd1', mapping: validMapping('fb-a') });
    await writeMapping({ pseudoPod, deviceId: 'd1', mapping: validMapping('fb-b') });

    const { mappings, errors } = await loadMappings({ pseudoPod, deviceId: 'd1' });
    expect(errors).toEqual([]);
    expect(mappings.map((m) => m.id).sort()).toEqual(['fb-a', 'fb-b']);
  });

  it('an absent mappings folder loads as empty (first run)', async () => {
    const { mappings, errors } = await loadMappings({ pseudoPod: mkPod('fresh'), deviceId: 'fresh' });
    expect(mappings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('tolerates a malformed mapping — collects it in errors, keeps the good ones', async () => {
    const pseudoPod = mkPod('d2');
    await writeMapping({ pseudoPod, deviceId: 'd2', mapping: validMapping('good') });
    // Write a structurally-broken mapping straight past the validator:
    await pseudoPod.write(mappingResourceUri({ deviceId: 'd2', id: 'broken' }), { id: 'broken' /* no ops */ });

    const { mappings, errors } = await loadMappings({ pseudoPod, deviceId: 'd2' });
    expect(mappings.map((m) => m.id)).toEqual(['good']);
    expect(errors).toHaveLength(1);
    expect(errors[0].uri).toContain('broken');
    expect(errors[0].code).toBe('INVALID_MAPPING');
  });

  it('removeMapping drops it from the next load', async () => {
    const pseudoPod = mkPod('d3');
    await writeMapping({ pseudoPod, deviceId: 'd3', mapping: validMapping('temp') });
    await removeMapping({ pseudoPod, deviceId: 'd3', id: 'temp' });

    const { mappings } = await loadMappings({ pseudoPod, deviceId: 'd3' });
    expect(mappings).toEqual([]);
  });
});
