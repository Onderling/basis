/**
 * FITNESS: history immutability (4b) — "no bot may EVER alter the edit
 * history" (PLAN-pod-versioning-history-recovery; the guard that backs
 * NOTE-online-agent-surface §5's anti-virus claim).
 *
 * Two halves:
 *  1. SKILL SURFACE (static): no manifest op across the composed catalogue
 *     names the version store's privileged `drop`/`prune`, and the agents
 *     app's wired skill set is exactly its manifest ops — history-erasing
 *     capability is structurally not grantable.
 *  2. HOSTILE BOT (behavioural): through the REAL composition, every route a
 *     bot has to the history layer is refused — restoreDataVersion aimed AT
 *     a history key (NOT_VERSIONABLE), direct pod write/delete
 *     (HISTORY_IMMUTABLE, incl. cache mode's _assertLocalWrite bypass), and
 *     a hostile peer's writeFromPeer (rejected-history-immutable) — and the
 *     history survives the whole assault byte-for-byte.
 *
 * If this test fails, a change has made history reachable/erasable by a
 * grantable capability — that is a SAFETY regression, not a style nit.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { createPseudoPod, createMemoryBackend } from '@onderling/pseudo-pod';
import { agentsManifest } from '../../../agents/manifest.js';
import { RECOVERY_CORES } from '../../../agents/src/recoveryCores.js';
import { AGENT_CORES } from '../../../agents/src/cores.js';
import { INSTALL_CORES } from '../../../agents/src/installCores.js';
import { createRealHouseholdAgent } from '../../src/core/agent/realAgent.js';
import {
  circleVersioningFor,
  getCircleVersionStore,
  _resetCircleVersionStores,
} from '../../src/web/circleVersioning.js';

beforeEach(() => _resetCircleVersionStores());

describe('FITNESS: 4b — the skill surface cannot name history-erasing ops', () => {
  it('no composed op id suggests drop/prune of the history layer', () => {
    const ids = agentsManifest.operations.map((o) => o.id.toLowerCase());
    for (const id of ids) {
      expect(id).not.toMatch(/dropversion|pruneversion|deleteversion|erasehistory|drophistory/);
    }
  });

  it('the wired agents cores are EXACTLY the manifest ops (nothing extra is skill-reachable)', () => {
    const coreIds = [
      ...Object.keys(AGENT_CORES),
      ...Object.keys(RECOVERY_CORES),
      ...Object.keys(INSTALL_CORES),
    ].sort();
    const opIds = agentsManifest.operations.map((o) => o.id).sort();
    expect(coreIds).toEqual(opIds);
    // The recovery surface is list + restore ONLY — the store's privileged
    // drop/prune are not among the cores.
    expect(Object.keys(RECOVERY_CORES).sort()).toEqual(['listDataVersions', 'restoreDataVersion']);
  });
});

describe('FITNESS: 4b — a hostile bot cannot alter history (behavioural, real composition)', () => {
  it('every route to the history layer is refused; history survives byte-for-byte', async () => {
    const circleId = 'circle-4b';
    const deviceId = `circle-${circleId}`;
    const backend  = createMemoryBackend();
    const versioning = circleVersioningFor(circleId, deviceId, backend);
    const pod = createPseudoPod({ backend, mode: 'standalone', deviceId, versioning });

    // Real history: a member's post displaced by a bot's vandalism.
    const uri = `pseudo-pod://${deviceId}/group/items/post-1`;
    await pod.write(uri, { text: 'original post' });
    await pod.write(uri, { text: 'VANDALISED' });
    const [snap] = await versioning.list(uri);
    const historyKey = `versions/${encodeURIComponent(uri)}/${snap.id}`;
    const before = await backend.get(historyKey);

    // Route 1 — the recovery SKILL aimed at a history key (a bot trying to
    // "restore" forged content INTO history): structured refusal.
    const a = await createRealHouseholdAgent({
      seedHousehold: false, versionStoreFor: getCircleVersionStore,
    });
    const viaSkill = await a.callSkill('agents', 'restoreDataVersion', {
      circleId, uri: historyKey, version: String(snap.ts),
    });
    expect(viaSkill.ok).toBe(false);
    expect(viaSkill.error).toBe('NOT_VERSIONABLE');

    // Route 2 — direct pod write/delete of the history key: hard refusal.
    await expect(pod.write(historyKey, { forged: true })).rejects.toMatchObject({ code: 'HISTORY_IMMUTABLE' });
    await expect(pod.delete(historyKey)).rejects.toMatchObject({ code: 'HISTORY_IMMUTABLE' });

    // Route 3 — a hostile PEER pushing a history overwrite: rejected status.
    const ring = createPseudoPod({
      backend, mode: 'replication-ring', deviceId, versioning,
      transport: { publishEnvelope: async () => {} }, getPeers: () => [],
    });
    expect((await ring.writeFromPeer(historyKey, { forged: true }, '"e"', 999)).status)
      .toBe('rejected-history-immutable');

    // The assault changed NOTHING: record identical, content identical.
    const after = await backend.get(historyKey);
    expect(after.bytes).toEqual(before.bytes);
    expect(await versioning.read(uri, snap.id)).toEqual({ text: 'original post' });
  });
});
