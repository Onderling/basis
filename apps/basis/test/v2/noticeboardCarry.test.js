import { describe, it, expect, vi } from 'vitest';
import { createCircleStores, memoryDataSource, createTaskStore, CircleItemStore } from '@onderling/item-store';
import { MemorySource } from '@onderling/core';
import { householdRegistry } from '../../src/v2/householdApp.js';
import { isLandedNoticeboardPost, landedNoticeboardHandler } from '../../src/v2/noticeboardCarry.js';
import { createRoutedStore } from '../../../pinboard/src/lib/routedStore.js';

const post = (over = {}) => ({ type: 'request', text: 'boormachine?', visibility: 'household', source: { targets: [{ kind: 'group', groupId: 'k1' }] }, ...over });
// a row as it sits in a circle store: the post's own fields plus the canonical base
const row = (over = {}) => ({ id: 'p1', ...post(), body: 'boormachine?', createdBy: 'webid:ada', createdAt: '2026-10-24T20:00:00.000Z', source: { ...post().source, from: 'webid:ada' }, ...over });

describe('noticeboard posts live in the circle store', () => {
  it('pinboard writes a post straight into the circle store, which its registry ACCEPTS, for every post kind', async () => {
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry: householdRegistry() });
    const pile = createTaskStore(new CircleItemStore({ dataSource: new MemorySource(), rootContainer: 'mem://neighbourhood/' }));
    const routed = createRoutedStore({ pile, hostCircles: { storeFor: (c) => stores.getStore(c), circlesOf: () => ['k1'], writerIn: () => 'webid:ada' } });
    const ids = [];
    for (const type of ['request', 'offer', 'announcement']) {
      const [made] = await routed.addItems([post({ type })], { actor: 'webid:ada' });
      ids.push(made.id);
    }
    const stored = await stores.getStore('k1').get(ids[0]);
    expect(stored.body).toBe('boormachine?');
    expect(stored.text, 'pinboard\'s own field rides along (additionalProperties)').toBe('boormachine?');
    expect(stored.createdBy).toBe('webid:ada');
    expect(stored.source.from).toBe('webid:ada');
    expect(await pile.listOpen({}), 'nothing of it in the pile').toEqual([]);
  });

  it('a landed post from SOMEONE ELSE is announced once — never my own, never a non-post row, never an update', async () => {
    const handleCirclePost = vi.fn(async () => ({ ok: true }));
    const onLanded = landedNoticeboardHandler({ handleCirclePost, self: 'webid:me' });
    await onLanded('k1', row(), { fresh: true });
    expect(handleCirclePost).toHaveBeenCalledTimes(1);
    const [from, envelope] = handleCirclePost.mock.calls[0];
    expect(from).toBe('webid:ada');
    expect(envelope).toMatchObject({ groupId: 'k1', fromPubKey: 'webid:ada', payload: { requestId: 'p1', text: 'boormachine?', type: 'request', from: 'webid:ada' } });
    await onLanded('k1', row({ claimedBy: 'webid:bob' }), { fresh: false });   // an update of the same post (a claim)
    await onLanded('k1', row({ id: 'mine', createdBy: 'webid:me', source: { from: 'webid:me' } }), { fresh: true });
    await onLanded('k1', { id: 't1', type: 'task', text: 'not a post', createdBy: 'webid:ada', createdAt: 'x' }, { fresh: true });
    await onLanded('k1', { id: 'r1', type: 'report', text: 'bespoke', createdBy: 'webid:ada', createdAt: 'x' }, { fresh: true });
    expect(handleCirclePost, 'an update / own post / a task / a bespoke row: not announced').toHaveBeenCalledTimes(1);
    expect(isLandedNoticeboardPost(null)).toBe(false);
  });
});
