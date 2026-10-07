/**
 * The household's announce rows: what a change tells others, as planned work in the household's own store — seeded
 * once, kept switched off when a household switched one off, and fired by a change to the item type each one watches.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource, createCircleStores } from '@onderling/item-store';
import { validate } from '@onderling/item-types';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { eventOccurrences } from '../src/v2/intentions.js';
import { seedAnnounceRows, ANNOUNCE_OP, HOUSEHOLD_ACTS_AS, isAnnounceRow } from '../src/v2/announceRows.js';

async function world() {
  const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
  const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'host' });
  await book.load();
  return { home, book };
}

describe('the household\'s announce rows', () => {
  it('are written once into the household\'s store, valid, acting as the household', async () => {
    const w = await world();
    expect(await seedAnnounceRows(w.book, 'c-home')).toBe(2);
    expect(await seedAnnounceRows(w.book, 'c-home')).toBe(0);
    const rows = (await w.home.listByType('intention')).filter(isAnnounceRow);
    expect(rows.map((r) => r.label).sort()).toEqual(['announce-appointments', 'announce-chores']);
    for (const r of rows) {
      expect(validate(r).ok).toBe(true);
      expect(r).toMatchObject({ op: ANNOUNCE_OP, actsAs: HOUSEHOLD_ACTS_AS, state: 'open' });
    }
  });

  it('one a household switched off stays off', async () => {
    const w = await world();
    await seedAnnounceRows(w.book, 'c-home');
    const chores = w.book.rows().find((r) => r.label === 'announce-chores');
    await w.book.cancel(chores.id);
    expect(await seedAnnounceRows(w.book, 'c-home')).toBe(0);
    expect((await w.home.get(chores.id)).state).toBe('cancelled');
  });

  it('an appointment change fires the appointments row with its kinds; a chore change the chores row', async () => {
    const w = await world();
    await seedAnnounceRows(w.book, 'c-home');
    const appt = { id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-12T12:00:00.000Z', clock: 1 };
    const fired = eventOccurrences({ rows: w.book.rows(), change: { circleId: 'c-home', before: null, after: appt } });
    expect(fired.map((o) => o.args.kinds)).toEqual([['new', 'moved', 'cancelled']]);
    const chore = { id: 'c1', type: 'task', text: 'vuilnis', assignees: ['telegram:2'], clock: 2 };
    const fired2 = eventOccurrences({ rows: w.book.rows(), change: { circleId: 'c-home', before: { ...chore, assignees: [], clock: 1 }, after: chore } });
    expect(fired2.map((o) => o.args.kinds)).toEqual([['given', 'moved']]);
  });
});
