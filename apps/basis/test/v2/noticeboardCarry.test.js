import { describe, it, expect, vi } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { householdRegistry } from '../../src/v2/householdApp.js';
import { toCircleStorePost, isLandedNoticeboardPost, landedNoticeboardHandler } from '../../src/v2/noticeboardCarry.js';

const post = (over = {}) => ({ id: 'p1', type: 'request', text: 'boormachine?', addedAt: 1_700_000_000_000, visibility: 'household', source: { targets: [{ kind: 'group', groupId: 'k1' }] }, ...over });

describe('one carry for noticeboard posts — the circle store and its lane', () => {
  it('a stoop post becomes a row the circle store\'s registry ACCEPTS (body + the base fields), for every post kind', async () => {
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry: householdRegistry() });
    const store = stores.getStore('k1');
    for (const type of ['request', 'offer', 'announcement']) {
      const row = toCircleStorePost(post({ id: `p-${type}`, type }), { from: 'webid:ada' });
      await expect(store.put(row, { by: 'webid:ada' })).resolves.toBeTruthy();
    }
    const stored = await store.get('p-request');
    expect(stored.body).toBe('boormachine?');
    expect(stored.text, 'stoop\'s own field rides along (additionalProperties)').toBe('boormachine?');
    expect(stored.createdBy).toBe('webid:ada');
    expect(stored.source.from).toBe('webid:ada');
  });
  it('the bridge forwards a post that landed from SOMEONE ELSE, never my own, never a non-post row', async () => {
    const handleCirclePost = vi.fn(async () => ({ ok: true }));
    const onLanded = landedNoticeboardHandler({ handleCirclePost, self: 'webid:me' });
    await onLanded('k1', toCircleStorePost(post(), { from: 'webid:ada' }));
    expect(handleCirclePost).toHaveBeenCalledTimes(1);
    const [from, envelope] = handleCirclePost.mock.calls[0];
    expect(from).toBe('webid:ada');
    expect(envelope).toMatchObject({ groupId: 'k1', fromPubKey: 'webid:ada', payload: { requestId: 'p1', text: 'boormachine?', type: 'request', from: 'webid:ada' } });
    await onLanded('k1', toCircleStorePost(post({ id: 'mine' }), { from: 'webid:me' }));
    await onLanded('k1', { id: 't1', type: 'task', text: 'not a post', createdBy: 'webid:ada', createdAt: 'x' });
    await onLanded('k1', { id: 'r1', type: 'report', text: 'bespoke', createdBy: 'webid:ada', createdAt: 'x' });
    expect(handleCirclePost, 'own post / a task / a bespoke row: not forwarded').toHaveBeenCalledTimes(1);
    expect(isLandedNoticeboardPost(null)).toBe(false);
  });
});
