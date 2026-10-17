/**
 * MemberMapCache — auto-persist tests (Pinboard V1 Phase 11.4).
 */

import { describe, it, expect } from 'vitest';
import { MemorySource } from '@onderling/core';
import { MemberMap } from '@onderling/identity-resolver';

import { MemberMapCache } from '../src/lib/MemberMapCache.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

describe('MemberMapCache.load', () => {
  it('returns an empty MemberMap when the prefix is empty', async () => {
    const ds = new MemorySource();
    const map = await MemberMapCache.load({ dataSource: ds, rootContainer: 'mem://pinboard/' });
    expect(await map.list()).toEqual([]);
  });

  it('rebuilds the MemberMap from previously-persisted entries', async () => {
    const ds = new MemorySource();
    await ds.write('mem://pinboard/members/' + encodeURIComponent(ANNE),
      JSON.stringify({ webid: ANNE, handle: 'anne', stableId: 'sid-anne' }));
    await ds.write('mem://pinboard/members/' + encodeURIComponent(BOB),
      JSON.stringify({ webid: BOB, handle: 'bob', stableId: 'sid-bob' }));

    const map = await MemberMapCache.load({ dataSource: ds, rootContainer: 'mem://pinboard/' });
    const found = await map.resolveByStableId('sid-anne');
    expect(found.webid).toBe(ANNE);
    expect(found.handle).toBe('anne');
  });

  it('skips corrupt entries without throwing', async () => {
    const ds = new MemorySource();
    await ds.write('mem://pinboard/members/' + encodeURIComponent(ANNE),
      JSON.stringify({ webid: ANNE, handle: 'anne' }));
    await ds.write('mem://pinboard/members/garbage', '{not valid json');

    const map = await MemberMapCache.load({ dataSource: ds, rootContainer: 'mem://pinboard/' });
    const list = await map.list();
    expect(list).toHaveLength(1);
    expect(list[0].handle).toBe('anne');
  });

  it('rejects construction without dataSource', async () => {
    await expect(MemberMapCache.load({})).rejects.toThrow(/dataSource/);
  });
});

describe('MemberMapCache.attach', () => {
  it('writes to dataSource on member-added', async () => {
    const ds = new MemorySource();
    const map = new MemberMap();
    const detach = MemberMapCache.attach({ map, dataSource: ds, rootContainer: 'mem://pinboard/' });
    await map.addMember({ webid: ANNE, handle: 'anne', stableId: 'sid' });
    // attach() listeners are sync-fire async-write; give the microtask a turn.
    await new Promise(r => setTimeout(r, 5));
    const raw = await ds.read('mem://pinboard/members/' + encodeURIComponent(ANNE));
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw);
    expect(parsed.handle).toBe('anne');
    expect(parsed.stableId).toBe('sid');
    detach();
  });

  it('writes again on member-updated', async () => {
    const ds = new MemorySource();
    const map = new MemberMap();
    MemberMapCache.attach({ map, dataSource: ds, rootContainer: 'mem://pinboard/' });
    await map.addMember({ webid: ANNE, handle: 'anne' });
    await map.addMember({ webid: ANNE, handle: 'anne-23' });   // update
    await new Promise(r => setTimeout(r, 5));
    const parsed = JSON.parse(await ds.read('mem://pinboard/members/' + encodeURIComponent(ANNE)));
    expect(parsed.handle).toBe('anne-23');
  });

  it('deletes from dataSource on member-removed', async () => {
    const ds = new MemorySource();
    const map = new MemberMap();
    MemberMapCache.attach({ map, dataSource: ds, rootContainer: 'mem://pinboard/' });
    await map.addMember({ webid: ANNE, handle: 'anne' });
    await new Promise(r => setTimeout(r, 5));
    expect(await ds.read('mem://pinboard/members/' + encodeURIComponent(ANNE))).toBeTruthy();
    await map.removeMember(ANNE);
    await new Promise(r => setTimeout(r, 5));
    expect(await ds.read('mem://pinboard/members/' + encodeURIComponent(ANNE))).toBeNull();
  });

  it('detach() stops further writes', async () => {
    const ds = new MemorySource();
    const map = new MemberMap();
    const detach = MemberMapCache.attach({ map, dataSource: ds, rootContainer: 'mem://pinboard/' });
    detach();
    await map.addMember({ webid: ANNE, handle: 'anne' });
    await new Promise(r => setTimeout(r, 5));
    expect(await ds.read('mem://pinboard/members/' + encodeURIComponent(ANNE))).toBeNull();
  });
});

describe('MemberMapCache.bootstrap (load + attach)', () => {
  it('loads existing entries + persists new mutations', async () => {
    const ds = new MemorySource();
    await ds.write('mem://pinboard/members/' + encodeURIComponent(ANNE),
      JSON.stringify({ webid: ANNE, handle: 'anne' }));

    const { map, detach } = await MemberMapCache.bootstrap({
      dataSource: ds, rootContainer: 'mem://pinboard/',
    });
    expect((await map.resolveByWebid(ANNE)).handle).toBe('anne');

    await map.addMember({ webid: BOB, handle: 'bob', stableId: 'sid-bob' });
    await new Promise(r => setTimeout(r, 5));
    const stored = JSON.parse(await ds.read('mem://pinboard/members/' + encodeURIComponent(BOB)));
    expect(stored.handle).toBe('bob');
    detach();
  });
});
