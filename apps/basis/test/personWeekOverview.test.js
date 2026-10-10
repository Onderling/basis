/**
 * The person's own week overview: a row in their own store (Saturday 09:00), switched from Gepland, run by the person's
 * clock while the app is open — a card of their coming week, saying honestly that it shows when the app is open.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { upcoming } from '../src/v2/intentions.js';
import { PERSON_WEEK_OP, personWeekOn, switchPersonWeek, personWeekCard } from '../src/v2/personWeekOverview.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);

describe('the person\'s own week overview', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is switched on and off as one row in their own store, on Saturday morning', async () => {
    // the row is anchored at its creation time (the store's clock), so the clock is a fixed Thursday: on the real clock
    // this test went off at 2026-10-10 07:00Z, when the Saturday it asserts became the past
    vi.useFakeTimers({ now: Date.parse('2026-10-08T09:00:00Z'), toFake: ['Date'] });
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'me' });
    await book.load();
    expect(personWeekOn(book, 'me')).toBe(false);
    await switchPersonWeek(book, 'me', true);
    await switchPersonWeek(book, 'me', true);   // twice on is one row
    expect(book.rows().filter((r) => r.op === PERSON_WEEK_OP && r.state === 'open')).toHaveLength(1);
    expect(personWeekOn(book, 'me')).toBe(true);
    const sat = upcoming({ rows: book.rows(), now: Date.parse('2026-10-08T10:00:00Z'), tz: 'Europe/Amsterdam', horizon: 7 * 86_400_000 });
    expect(new Date(sat[0].at).toISOString()).toBe('2026-10-10T07:00:00.000Z');   // Saturday 09:00 Amsterdam
    await switchPersonWeek(book, 'me', false);
    expect(personWeekOn(book, 'me')).toBe(false);
  });

  it('its card is the coming week, and says it shows when the app is open', async () => {
    const callSkill = async (app, op) => {
      if (app === 'stoop' && op === 'listMyCircles') return { circles: [] };
      if (app === 'calendar' && op === 'listEvents') return { ok: true, items: [{ id: 'e1', title: 'tandarts', startsAt: '2026-10-12T12:00:00.000Z' }] };
      return { ok: true, items: [] };
    };
    const card = await personWeekCard({ callSkill, me: 'me', t, tz: 'Europe/Amsterdam', now: Date.parse('2026-10-10T07:00:00Z') });
    expect(card.title).toBe('circle.profile.week_card_title');
    expect(card.note).toBe('circle.profile.week_card_note');
    expect(Array.isArray(card.lines)).toBe(true);
  });
});
