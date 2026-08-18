/**
 * H5 V0 multi-group cluster — Phase 7 group-switcher product item.
 *
 * Validates the "one identity, many groups" V0 model: a single
 * `AgentIdentity` (stable pubkey) drives N `core.Agent` instances, one
 * per group, each with its own OfferingMatch. Item-stores are per-group so
 * a request posted in group A is invisible in group B.
 *
 * Also exercises the launcher's `extraStaticFiles: {'/groups.json'}`
 * path through `mountLocalUi`: the per-group UI fetches it to populate
 * the switcher dropdown.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DataPart } from '@onderling/core';
import { mountLocalUi, LocalUiAuth } from '@onderling/agent-ui';

import { createNeighborhoodCluster } from '../src/cluster.js';

const ANNE = 'https://id.example/anne';
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

async function callSkill(agent, skillId, args, fromWebid) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

describe('createNeighborhoodCluster', () => {
  it('shares identity across groups; per-group item-stores are isolated', async () => {
    const cluster = await createNeighborhoodCluster({
      groups: [
        { groupId: 'block-42', localActor: ANNE },
        { groupId: 'book-club', localActor: ANNE },
      ],
    });

    expect(cluster.groups.size).toBe(2);
    const aBundle = cluster.groups.get('block-42');
    const bBundle = cluster.groups.get('book-club');
    expect(aBundle.agent.identity.pubKey).toBe(bBundle.agent.identity.pubKey);
    expect(aBundle.agent.identity.pubKey).toBe(cluster.identity.pubKey);

    // OfferingMatch must be started before postRequest can broadcast.
    for (const b of cluster.groups.values()) await b.offeringMatch.start();

    // No peers — broadcast times out immediately. We're testing the
    // store isolation and the post path, not the matchmaking loop.
    const r = await callSkill(aBundle.agent, 'postRequest', {
      text: 'Paint my fence', requiredSkills: ['paint'], timeoutMs: 30,
    }, ANNE);
    expect(r.requestId).toBeTruthy();

    // The request should appear in group A's store but NOT in group B's.
    const openA = await aBundle.itemStore.listOpen();
    const openB = await bBundle.itemStore.listOpen();
    expect(openA).toHaveLength(1);
    expect(openA[0].text).toBe('Paint my fence');
    expect(openB).toHaveLength(0);
  });

  it('rejects duplicate groupId in groups[]', async () => {
    await expect(createNeighborhoodCluster({
      groups: [
        { groupId: 'block-42', localActor: ANNE },
        { groupId: 'block-42', localActor: ANNE },
      ],
    })).rejects.toThrow(/duplicate groupId/);
  });

  it('rejects empty groups', async () => {
    await expect(createNeighborhoodCluster({ groups: [] }))
      .rejects.toThrow(/at least one/);
  });
});

describe('multi-group launcher (mountLocalUi extraStaticFiles)', () => {
  it('serves a runtime-built /groups.json under each per-group UI', async () => {
    const cluster = await createNeighborhoodCluster({
      groups: [
        { groupId: 'block-42', localActor: ANNE },
        { groupId: 'book-club', localActor: ANNE },
      ],
    });
    for (const b of cluster.groups.values()) await b.offeringMatch.start();

    // Shared mutable map — all instances see updates by reference.
    const sharedExtras = { '/groups.json': '[]' };
    const uis = new Map();
    for (const [gid, bundle] of cluster.groups) {
      const ui = await mountLocalUi(bundle.agent, {
        port:             0,
        staticDir:        WEB_DIR,
        a2aTLSLayer:      new LocalUiAuth({ localActor: ANNE }),
        extraStaticFiles: sharedExtras,
      });
      uis.set(gid, ui);
    }
    // Patch in the index now that all ports are known.
    const groupIndex = [...uis.entries()].map(([groupId, ui]) => ({
      groupId, url: ui.url,
    }));
    sharedExtras['/groups.json'] = JSON.stringify(groupIndex);

    // Both instances must serve the SAME group index.
    for (const ui of uis.values()) {
      const res = await fetch(`${ui.url}/groups.json`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/application\/json/);
      const parsed = await res.json();
      expect(parsed).toEqual(groupIndex);
    }

    for (const ui of uis.values()) await ui.stop();
  });
});
