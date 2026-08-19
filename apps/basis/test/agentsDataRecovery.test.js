/**
 * agents — data-recovery ops through the REAL composition (web wiring).
 *
 * Proves the end-to-end J7 arc on the actual plumbing: a circle pod built
 * the way `circleApp.makeCirclePodClient` does it (same backend into
 * `circleVersioningFor` + `createPseudoPod`), the resolver threaded into
 * `createRealHouseholdAgent({ versionStoreFor })`, and the ops invoked
 * over `callSkill('agents', …)`:
 *   - a bad overwrite + a delete land in the circle's version history;
 *   - `listDataVersions` surfaces the series + per-uri pick-list;
 *   - `restoreDataVersion` rolls the live resource back — UNDOABLY (the
 *     pre-restore state is itself snapshotted).
 *   - without a resolver (default boot), the ops answer the honest
 *     `no-version-store` miss.
 *
 * Op semantics in isolation are covered by the apps/agents unit suite —
 * this test stays at the composition level.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import {
  circleVersioningFor,
  getCircleVersionStore,
  _resetCircleVersionStores,
} from '../src/web/circleVersioning.js';

beforeEach(() => _resetCircleVersionStores());

/** A versioned circle pod, wired exactly like makeCirclePodClient. */
function makeVersionedCirclePod(circleId) {
  const deviceId = `circle-${circleId}`;
  const backend  = createMemoryBackend();
  const versioning = circleVersioningFor(circleId, deviceId, backend);
  const pod = createPseudoPod({ backend, mode: 'standalone', deviceId, versioning });
  return { pod, deviceId };
}

describe('agents P3 — restore corrupted / lost data through the real composition', () => {
  it('list + restore over a vandalised circle resource (the J7 arc)', async () => {
    const circleId = 'circle-recovery';
    const { pod, deviceId } = makeVersionedCirclePod(circleId);
    const uri = `pseudo-pod://${deviceId}/group/items/post-1`;

    // A member writes; an infected bot vandalises, then deletes.
    await pod.write(uri, { text: 'original post' });
    await pod.write(uri, { text: 'VANDALISED' });
    await pod.delete(uri);

    const a = await createRealHouseholdAgent({
      seedHousehold: false,
      versionStoreFor: getCircleVersionStore,   // ← the web threading under test
    });

    // Series roster shows the damaged resource…
    const roster = await a.callSkill('agents', 'listDataVersions', { circleId });
    expect(roster.ok).toBe(true);
    expect(roster.series.map((s) => s.uri)).toContain(uri);

    // …its pick-list holds both displaced states, newest-first…
    const list = await a.callSkill('agents', 'listDataVersions', { circleId, uri });
    expect(list.ok).toBe(true);
    expect(list.versions).toHaveLength(2); // 'VANDALISED' (displaced by delete) + 'original post'
    const oldest = list.versions[list.versions.length - 1];

    // …and restore rolls the live resource back to the original.
    const restored = await a.callSkill('agents', 'restoreDataVersion', {
      circleId, uri, version: oldest.id,
    });
    expect(restored.ok).toBe(true);
    expect(restored.restoredFromMs).toBe(oldest.ts);
    expect(restored.snapshotMsBeforeRestore).not.toBeNull(); // undoable

    // Verify the RESULT (not just the dispatch): the LIVE resource is back.
    const live = await pod.read(uri);
    expect(live.bytes).toEqual({ text: 'original post' });
  });

  it('unknown circle / missing resolver answer honest structured misses', async () => {
    const withResolver = await createRealHouseholdAgent({
      seedHousehold: false, versionStoreFor: getCircleVersionStore,
    });
    expect(await withResolver.callSkill('agents', 'listDataVersions', { circleId: 'nope' }))
      .toMatchObject({ ok: false, error: 'no-version-store' });

    const defaultBoot = await createRealHouseholdAgent({ seedHousehold: false });
    expect(await defaultBoot.callSkill('agents', 'listDataVersions', { circleId: 'circle-x' }))
      .toMatchObject({ ok: false, error: 'no-version-store' });
  });
});
