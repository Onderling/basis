/**
 * circleVersioning — per-circle pod version history (web).
 *
 * Covers: webSha256 correctness (vs node:crypto), build-once per circle,
 * getter resolution, and the end-to-end contract — a circle pseudo-pod
 * constructed the way `circleApp.makeCirclePodClient` does it (same
 * backend + versioning store) snapshots displaced bytes and restores them.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import {
  webSha256,
  circleVersioningFor,
  getCircleVersionStore,
  _resetCircleVersionStores,
} from '../src/web/circleVersioning.js';

beforeEach(() => _resetCircleVersionStores());

describe('webSha256', () => {
  it('matches node:crypto sha256 for strings and bytes', async () => {
    const nodeSha = (buf) => createHash('sha256').update(buf).digest('hex');
    expect(await webSha256('hello')).toBe(nodeSha(Buffer.from('hello', 'utf8')));
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await webSha256(bytes)).toBe(nodeSha(Buffer.from(bytes)));
  });

  it('hashes non-string values via their JSON form (pod bytes are opaque)', async () => {
    const nodeSha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
    expect(await webSha256({ a: 1 })).toBe(nodeSha(JSON.stringify({ a: 1 })));
  });
});

describe('circleVersioningFor — build-once + resolution', () => {
  it('builds one store per circle and returns the same instance thereafter', () => {
    const backend = createMemoryBackend();
    const first = circleVersioningFor('circle-1', 'circle-view-1', backend);
    const again = circleVersioningFor('circle-1', 'circle-view-1', backend);
    expect(again).toBe(first);
    expect(getCircleVersionStore('circle-1')).toBe(first);
  });

  it('returns null for a circle whose pod was never built', () => {
    expect(getCircleVersionStore('nope')).toBeNull();
  });
});

describe('end-to-end — the makeCirclePodClient wiring contract', () => {
  it('a versioned circle pod snapshots displaced bytes and restores them', async () => {
    // Mirror makeCirclePodClient: same backend into store + pod.
    const circleId = 'circle-e2e';
    const deviceId = `circle-${circleId}`;
    const backend  = createMemoryBackend();
    const versioning = circleVersioningFor(circleId, deviceId, backend);
    const pod = createPseudoPod({ backend, mode: 'standalone', deviceId, versioning });

    const uri = `pseudo-pod://${deviceId}/group/items/post-1`;
    await pod.write(uri, { text: 'original post' });
    await pod.write(uri, { text: 'vandalised by an infected bot' }); // displaces the original

    const store = getCircleVersionStore(circleId);
    const versions = await store.list(uri, { withContent: true });
    expect(versions).toHaveLength(1);
    expect(versions[0].content).toEqual({ text: 'original post' });
    expect(versions[0].writer).toBe(deviceId); // multi-writer key carries the pod's deviceId

    // Delete is recoverable too (the most destructive op).
    await pod.delete(uri);
    const afterDelete = await store.list(uri);
    expect(afterDelete).toHaveLength(2);

    // And version keys never leak into the live container listing.
    await pod.write(uri, { text: 'fresh' });
    const listed = await pod.list(`pseudo-pod://${deviceId}/group/items`);
    expect(listed).toEqual([uri]);
  });
});
