/**
 * A wall-clock time in a zone, as a UTC instant, on the days the clocks change. The offset that applies is the one AT
 * the instant asked for, not at the naive instant read as UTC: on the night summer time ends in Amsterdam (2026-10-25,
 * 03:00 → 02:00, at 01:00 UTC), 01:03 is still summer time (UTC+2), while the naive instant 01:03 UTC is already
 * winter time. Read once, the offset came out an hour late — a reminder at 01:30 that night rang at 02:30.
 */
import { describe, it, expect } from 'vitest';
import { utcInstantForWallClock, wallClockInTz } from '../src/timezone.js';

const TZ = 'Europe/Amsterdam';
const at = (y, mo, d, h, mi) => utcInstantForWallClock({ year: y, month: mo, day: d, hour: h, minute: mi, tz: TZ });
const iso = (ms) => new Date(ms).toISOString().slice(0, 16);

describe('utcInstantForWallClock across daylight saving', () => {
  it('the hour before summer time ends is still summer time', () => {
    expect(iso(at(2026, 10, 25, 1, 3))).toBe('2026-10-24T23:03');
    expect(iso(at(2026, 10, 25, 0, 30))).toBe('2026-10-24T22:30');
  });
  it('after the change, winter time', () => {
    expect(iso(at(2026, 10, 25, 3, 0))).toBe('2026-10-25T02:00');
    expect(iso(at(2026, 10, 25, 23, 0))).toBe('2026-10-25T22:00');
  });
  it('around summer time starting (2026-03-29, 02:00 → 03:00)', () => {
    expect(iso(at(2026, 3, 29, 1, 30))).toBe('2026-03-29T00:30');
    expect(iso(at(2026, 3, 29, 3, 30))).toBe('2026-03-29T01:30');
  });
  it('every whole hour of both change days reads back as the same wall clock (the ambiguous and missing hours aside)', () => {
    for (const [mo, d, skip] of [[10, 25, 2], [3, 29, 2]]) {
      for (let h = 0; h < 24; h += 1) {
        if (h === skip) continue;   // 02:xx: twice in October, never in March
        const w = wallClockInTz(at(2026, mo, d, h, 15), TZ);
        expect([w.month, w.day, w.hour, w.minute], `${mo}-${d} ${h}:15`).toEqual([mo, d, h, 15]);
      }
    }
  });
  it('a plain day is unchanged', () => {
    expect(iso(at(2026, 6, 10, 17, 0))).toBe('2026-06-10T15:00');
    expect(iso(at(2026, 1, 10, 17, 0))).toBe('2026-01-10T16:00');
  });
});
