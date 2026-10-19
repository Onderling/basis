/**
 * An appointment can be CHANGED — a new title and/or a new moment — and keeps its length; a day without a time is the
 * whole day; an empty title or an unreadable moment is refused, nothing written.
 */
import { describe, it, expect } from 'vitest';
import { CalendarStore, retimeEvent, buildEvent } from '../src/index.js';

describe('retimeEvent', () => {
  const ev = buildEvent({ title: 'tandarts', when: '2026-11-03T14:00:00.000Z', duration: '30m' });
  it('a new moment keeps the length; a new title alone keeps the moment', () => {
    const moved = retimeEvent(ev, { when: '2026-11-04T09:00:00.000Z' });
    expect(moved.startsAt).toBe('2026-11-04T09:00:00.000Z');
    expect(new Date(moved.endsAt) - new Date(moved.startsAt)).toBe(30 * 60_000);
    const renamed = retimeEvent(ev, { title: 'tandarts (controle)' });
    expect([renamed.title, renamed.startsAt]).toEqual(['tandarts (controle)', ev.startsAt]);
  });
  it('a day without a time is the whole day; an empty title is refused', () => {
    const day = retimeEvent(ev, { when: '2026-11-05' });
    expect(new Date(day.endsAt) - new Date(day.startsAt)).toBe(86_400_000);
    expect(() => retimeEvent(ev, { title: '  ' })).toThrow(/title/);
  });
});

describe('CalendarStore.update', () => {
  it('writes the change; an unknown id throws', async () => {
    const store = new CalendarStore();
    const ev = await store.addEvent({ title: 'kapper', when: '2026-11-04T09:00:00.000Z' });
    await store.update({ eventId: ev.id, title: 'kapper Jan' });
    expect((await store.getById(ev.id)).title).toBe('kapper Jan');
    await expect(store.update({ eventId: 'nope', title: 'x' })).rejects.toThrow(/no event/);
  });
});
