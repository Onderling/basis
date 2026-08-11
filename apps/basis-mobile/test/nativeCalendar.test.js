/**
 * nativeCalendar (the items-mobile salvage, noun-generalized) — diff/apply coverage.
 * Ported with the module at its source app's retirement; `itemId` became `itemId`.
 */

import { describe, it, expect, vi } from 'vitest';
import { diffEvents, applyDiff, _internal } from '../src/core/nativeCalendar.js';

const MS_2026_06_01_09 = Date.UTC(2026, 5, 1, 9, 0);
const MS_2026_06_02_09 = Date.UTC(2026, 5, 2, 9, 0);
const MS_2026_06_03_10 = Date.UTC(2026, 5, 3, 10, 0);

describe('diffEvents — create/update/remove split', () => {
  it('emits create for new items with a date', () => {
    const next = [{ itemId: 'A', text: 'Buy milk', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev: [], next, eventIdByItem: {} });
    expect(r.create).toHaveLength(1);
    expect(r.create[0].itemId).toBe('A');
    expect(r.update).toHaveLength(0);
    expect(r.remove).toHaveLength(0);
  });

  it('skips dateless items', () => {
    const next = [{ itemId: 'A', text: 'No date' }];
    const r = diffEvents({ prev: [], next, eventIdByItem: {} });
    expect(r.create).toHaveLength(0);
  });

  it('emits update when fields change', () => {
    const prev = [{ itemId: 'A', text: 'Buy milk',  dueAt: MS_2026_06_01_09 }];
    const next = [{ itemId: 'A', text: 'Buy bread', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev, next, eventIdByItem: { A: 'cal-evt-1' } });
    expect(r.update).toHaveLength(1);
    expect(r.update[0]).toMatchObject({ itemId: 'A', eventId: 'cal-evt-1' });
    expect(r.create).toHaveLength(0);
    expect(r.remove).toHaveLength(0);
  });

  it('skips update when fields are stable', () => {
    const prev = [{ itemId: 'A', text: 'Buy milk', dueAt: MS_2026_06_01_09 }];
    const next = [{ itemId: 'A', text: 'Buy milk', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev, next, eventIdByItem: { A: 'cal-evt-1' } });
    expect(r.update).toHaveLength(0);
  });

  it('emits remove when a previously-emitted item drops off', () => {
    const prev = [{ itemId: 'A', dueAt: MS_2026_06_01_09 }];
    const r = diffEvents({ prev, next: [], eventIdByItem: { A: 'cal-evt-1' } });
    expect(r.remove).toHaveLength(1);
    expect(r.remove[0]).toEqual({ itemId: 'A', eventId: 'cal-evt-1' });
  });

  it('prefers scheduledAt over dueAt for the start time', () => {
    const ev = _internal._toEvent({
      itemId: 'A', text: 'X',
      dueAt: MS_2026_06_03_10, scheduledAt: MS_2026_06_01_09,
    });
    expect(ev.startDate.getTime()).toBe(MS_2026_06_01_09);
  });
});

describe('applyDiff — calendar API + storage map', () => {
  it('creates events + persists eventIds', async () => {
    const stored = new Map();
    const storage = {
      getItem:    async (k) => stored.get(k) ?? null,
      setItem:    async (k, v) => { stored.set(k, v); },
      removeItem: async (k) => { stored.delete(k); },
    };
    const Calendar = {
      createEventAsync: vi.fn(async (calId, ev) => `evt-${ev.title}`),
      updateEventAsync: vi.fn(async () => true),
      deleteEventAsync: vi.fn(async () => true),
    };
    const diff = {
      create: [{ itemId: 'A', ev: { title: 'A1' } }],
      update: [],
      remove: [],
    };
    const next = await applyDiff({
      CalendarModule: Calendar, calendarId: 'cal-1', diff, eventIdByItem: {}, storage,
    });
    expect(Calendar.createEventAsync).toHaveBeenCalledOnce();
    expect(next.A).toBe('evt-A1');
    const persisted = JSON.parse(stored.get(_internal.STORAGE_KEY));
    expect(persisted.A).toBe('evt-A1');
  });

  it('drops eventIds from the map when removing', async () => {
    const stored = new Map();
    const storage = {
      getItem:    async (k) => stored.get(k) ?? null,
      setItem:    async (k, v) => { stored.set(k, v); },
      removeItem: async (k) => { stored.delete(k); },
    };
    const Calendar = {
      createEventAsync: vi.fn(),
      updateEventAsync: vi.fn(),
      deleteEventAsync: vi.fn(async () => true),
    };
    const diff = { create: [], update: [], remove: [{ itemId: 'A', eventId: 'evt-1' }] };
    const next = await applyDiff({
      CalendarModule: Calendar, calendarId: 'cal-1', diff,
      eventIdByItem: { A: 'evt-1' }, storage,
    });
    expect(next).not.toHaveProperty('A');
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('evt-1');
  });
});
