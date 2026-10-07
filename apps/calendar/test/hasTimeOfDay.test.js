/**
 * Does a `when` name a time of day, or only a day? A move keeps an appointment's time of day when only a day is said.
 */
import { describe, it, expect } from 'vitest';
import { hasTimeOfDay } from '../src/CalendarStore.js';

describe('hasTimeOfDay', () => {
  it('a bare date or a day in words is a day; an ISO time or "friday 3pm" is a time', () => {
    for (const day of ['2026-10-09', 'friday', 'tomorrow', '']) expect(hasTimeOfDay(day), day).toBe(false);
    for (const time of ['2026-10-09T14:00', '2026-10-09 14:00', 'friday 3pm', 'tomorrow at 14:00']) expect(hasTimeOfDay(time), time).toBe(true);
  });
});
