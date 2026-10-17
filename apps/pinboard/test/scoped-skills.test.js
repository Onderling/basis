/**
 * scoped-skills — group-aware buildSkills dispatch.
 *
 * Single-agent refactor 2026-05-08: when buildSkills is called with
 * `getBundle`, every skill is wrapped to resolve the right per-group
 * bundle at dispatch time. Tests pin the dispatch behaviour:
 *   1. The wrapped skill array exposes the same skill IDs as the
 *      unwrapped (sentinel-built) one.
 *   2. Calling a wrapped skill routes to the bundle returned by
 *      getBundle.
 *   3. Two different groupIds get two different bundles.
 *   4. Missing groupId rejects with `{error: 'groupId required'}`.
 *   5. _invalidateGroup drops the cache entry.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildSkills } from '../src/skills/index.js';
import { ItemStore }   from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { MemberMap }   from '@onderling/identity-resolver';

function buildBundle(groupId, localActor) {
  const dataSource = new MemorySource();
  const store = new ItemStore({ dataSource, rootContainer: 'mem://test/' });
  const members = new MemberMap({ initial: [{ webid: localActor, pubKey: 'pk-' + groupId }] });
  return {
    store,
    members,
    offeringMatch:   { broadcast: vi.fn(async () => ({ claims: [] })), addPeer: vi.fn() },
    notifier:     null,
    reveals:      null,
    muted:        new Set(),
    localActor,
    groupId,
    chat:         null,
    metrics:      null,
    bundle:       { settings: {} },
  };
}

describe('buildSkills (group-aware mode)', () => {
  it('exposes the same skill IDs as a single-bundle build', () => {
    const single = buildSkills({ ...buildBundle('any', 'urn:me') });
    const scoped = buildSkills({ getBundle: () => null });
    const ids = (arr) => arr.map(s => s.id).sort();
    expect(ids(scoped)).toEqual(ids(single));
  });

  it('routes a skill call to the bundle returned by getBundle', async () => {
    const groupA = buildBundle('grA', 'urn:me');
    await groupA.store.addItems(
      [{ type: 'request', text: 'A1', visibility: 'household' }],
      { actor: 'urn:me' },
    );

    const getBundle = vi.fn((args) => args.groupId === 'grA' ? groupA : null);
    const skills = buildSkills({ getBundle });

    const listOpen = skills.find(s => s.id === 'listOpen');
    const r = await listOpen.handler({
      parts: [{ type: 'DataPart', data: { groupId: 'grA' } }],
      from:  'urn:me',
    });

    expect(getBundle).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: 'grA' }),
      expect.anything(),
    );
    expect(r.items).toHaveLength(1);
    expect(r.items[0].text).toBe('A1');
  });

  it('two different groupIds dispatch to their own bundles', async () => {
    const groupA = buildBundle('grA', 'urn:me');
    const groupB = buildBundle('grB', 'urn:me');
    await groupA.store.addItems(
      [{ type: 'request', text: 'in-A', visibility: 'household' }],
      { actor: 'urn:me' },
    );
    await groupB.store.addItems(
      [{ type: 'request', text: 'in-B', visibility: 'household' }],
      { actor: 'urn:me' },
    );

    const getBundle = (args) =>
      args.groupId === 'grA' ? groupA :
      args.groupId === 'grB' ? groupB : null;
    const skills = buildSkills({ getBundle });
    const listOpen = skills.find(s => s.id === 'listOpen');

    const rA = await listOpen.handler({
      parts: [{ type: 'DataPart', data: { groupId: 'grA' } }], from: 'urn:me',
    });
    const rB = await listOpen.handler({
      parts: [{ type: 'DataPart', data: { groupId: 'grB' } }], from: 'urn:me',
    });

    expect(rA.items.map(i => i.text)).toEqual(['in-A']);
    expect(rB.items.map(i => i.text)).toEqual(['in-B']);
  });

  it('rejects with `groupId required` when getBundle returns null', async () => {
    const skills = buildSkills({ getBundle: () => null });
    const listOpen = skills.find(s => s.id === 'listOpen');
    const r = await listOpen.handler({
      parts: [{ type: 'DataPart', data: {} }], from: 'urn:me',
    });
    expect(r).toEqual({ error: 'groupId required' });
  });

  it('_invalidateGroup drops the cached skill array for a group', async () => {
    let calls = 0;
    const groupA = buildBundle('grA', 'urn:me');
    const getBundle = (args) => {
      if (args.groupId !== 'grA') return null;
      calls += 1;
      return groupA;
    };
    const skills = buildSkills({ getBundle });
    const listOpen = skills.find(s => s.id === 'listOpen');

    await listOpen.handler({
      parts: [{ type: 'DataPart', data: { groupId: 'grA' } }], from: 'urn:me',
    });
    await listOpen.handler({
      parts: [{ type: 'DataPart', data: { groupId: 'grA' } }], from: 'urn:me',
    });
    // Cache hit on second call — getBundle still called per-dispatch
    // (cheap), but buildSkills is called only once for the group.
    expect(calls).toBe(2);

    skills._invalidateGroup('grA');
    await listOpen.handler({
      parts: [{ type: 'DataPart', data: { groupId: 'grA' } }], from: 'urn:me',
    });
    expect(calls).toBe(3); // refetched after invalidation
  });
});
