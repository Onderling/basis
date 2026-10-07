/**
 * The own-devices store and the intention book over it: a host's own rows (and, on a household bot, the rows of the
 * people it is the device for) are typed items in ONE store keyed by the own-devices scope — durable, never a circle's.
 * The book writes rows, finishes them, cancels them, and reads them synchronously after `load()` (a setting's "now").
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource, createCircleStores } from '@onderling/item-store';
import { validate } from '@onderling/item-types';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';

const weekly = { trigger: { every: 'week', on: 'sun', at: '18:00' }, op: 'sendWeekOverview', appOrigin: 'assistant', args: {}, actsAs: 'telegram:1', label: 'week overview' };

describe('the intention book', () => {
  it('writes a valid intention row into the own-devices store, and a fresh book over the same source reads it back', async () => {
    const ds = memoryDataSource();
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: ds }), actor: 'bot' });
    await book.load();
    const row = await book.intend(weekly);
    expect(validate(row).ok).toBe(true);
    expect(row).toMatchObject({ type: 'intention', state: 'open', createdBy: 'bot', actsAs: 'telegram:1' });
    const again = createIntentionBook({ store: createOwnDevicesStore({ dataSource: ds }), actor: 'bot' });
    await again.load();
    expect(again.rows().map((r) => r.id)).toEqual([row.id]);
  });

  it('finds a person\'s open rows for an op, and a cancelled row is no longer open', async () => {
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'bot' });
    await book.load();
    const row = await book.intend(weekly);
    await book.intend({ ...weekly, actsAs: 'telegram:2' });
    expect(book.openFor('telegram:1', 'sendWeekOverview').map((r) => r.id)).toEqual([row.id]);
    await book.cancel(row.id);
    expect(book.openFor('telegram:1', 'sendWeekOverview')).toEqual([]);
    expect(book.rows().find((r) => r.id === row.id).state).toBe('cancelled');
  });

  it('a run finishes a one-off row and moves a recurring row\'s last run', async () => {
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'bot', now: () => Date.parse('2026-10-11T16:01:00Z') });
    await book.load();
    const once = await book.intend({ ...weekly, trigger: { at: '2026-10-11T16:00:00.000Z' } });
    const every = await book.intend(weekly);
    await book.ran(once.id);
    await book.ran(every.id);
    const byId = Object.fromEntries(book.rows().map((r) => [r.id, r]));
    expect(byId[once.id]).toMatchObject({ state: 'done', lastRunAt: '2026-10-11T16:01:00.000Z' });
    expect(byId[every.id]).toMatchObject({ state: 'open', lastRunAt: '2026-10-11T16:01:00.000Z' });
  });

  it('refuses a row without an op or a person to act as', async () => {
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'bot' });
    await book.load();
    await expect(book.intend({ ...weekly, op: '' })).rejects.toThrow(/op/);
    await expect(book.intend({ ...weekly, actsAs: null })).rejects.toThrow(/actsAs/);
  });
});

describe('the book over every store the host holds', () => {
  const circleStore = (id) => createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore(id);

  it('reads the rows of each circle store beside its own, and knows which store a row is in', async () => {
    const own = createOwnDevicesStore({ dataSource: memoryDataSource() });
    const home = circleStore('c-home');
    const fromAMember = await home.put({ type: 'intention', ...weekly, actsAs: 'telegram:2', state: 'open' }, { by: 'member' });
    const book = createIntentionBook({ store: own, circles: async () => [{ scope: 'c-home', store: home }], actor: 'bot' });
    await book.load();
    const mine = await book.intend(weekly);
    expect(book.rows().map((r) => r.id).sort()).toEqual([mine.id, fromAMember.id].sort());
    expect(book.scopeOf(mine.id)).toBe(null);
    expect(book.scopeOf(fromAMember.id)).toBe('c-home');
  });

  it('writes a row into the circle it names, and finishes it there', async () => {
    const home = circleStore('c-home');
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'bot' });
    await book.load();
    const row = await book.intend({ ...weekly, trigger: { at: '2026-10-11T16:00:00.000Z' }, scope: 'c-home' });
    expect((await home.get(row.id))?.op).toBe('sendWeekOverview');
    await book.ran(row.id);
    expect((await home.get(row.id))?.state).toBe('done');
    await expect(book.intend({ ...weekly, scope: 'c-elsewhere' })).rejects.toThrow(/c-elsewhere/);
  });
});
