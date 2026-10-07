/**
 * The change feed: one place a host hears that an item it holds changed — its own write or one that landed — handed to
 * every consumer with the item before and after. A restart never makes every item look new.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createChangeFeed } from '../src/v2/changeFeed.js';

const appt = { type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-12T12:00:00.000Z' };

async function world() {
  const stores = createCircleStores({ dataSource: memoryDataSource() });
  const heard = [];
  const feed = createChangeFeed({ storeFor: (id) => stores.getStore(id), consumers: [(c, o) => heard.push({ ...c, origin: o.origin })] });
  return { store: stores.getStore('c1'), feed, heard };
}

describe('the change feed', () => {
  it('a new item reaches the consumers with nothing before; a move with the item as it was', async () => {
    const w = await world();
    await w.feed.seedAll(['c1']);
    const made = await w.store.put(appt, { by: 'a' });
    await w.feed.own('c1', made);
    const moved = await w.store.put({ ...made, startsAt: '2026-10-12T13:00:00.000Z' }, { by: 'b', sync: false });
    await w.feed.landed('c1', moved);
    expect(w.heard.map((h) => [h.origin, h.before?.startsAt ?? null, h.after.startsAt])).toEqual([
      ['own', null, '2026-10-12T12:00:00.000Z'],
      ['landed', '2026-10-12T12:00:00.000Z', '2026-10-12T13:00:00.000Z'],
    ]);
  });

  it('after a restart, an item the store already held is not new', async () => {
    const w = await world();
    const made = await w.store.put(appt, { by: 'a' });
    await w.feed.seedAll(['c1']);
    await w.feed.landed('c1', made);
    expect(w.heard[0].before).toMatchObject({ id: made.id });
  });

  it('a circle not seeded yet: its first change compares with what the store holds, so it is never "new"', async () => {
    const w = await world();
    const made = await w.store.put(appt, { by: 'a' });
    await w.feed.landed('c1', made);
    expect(w.heard[0].before).toMatchObject({ id: made.id });
  });

  it('a removal reaches the consumers with the item as it was and nothing after', async () => {
    const w = await world();
    await w.feed.seedAll(['c1']);
    const made = await w.store.put(appt, { by: 'a' });
    await w.feed.own('c1', made);
    await w.feed.removed('c1', made.id);
    expect(w.heard[1]).toMatchObject({ before: { id: made.id }, after: null, origin: 'own' });
  });

  it('one consumer failing never stops another', async () => {
    const stores = createCircleStores({ dataSource: memoryDataSource() });
    const heard = [];
    const feed = createChangeFeed({ storeFor: (id) => stores.getStore(id), consumers: [() => { throw new Error('x'); }, (c) => heard.push(c.after.id)] });
    await feed.own('c1', await stores.getStore('c1').put(appt, { by: 'a' }));
    expect(heard).toHaveLength(1);
  });
});
