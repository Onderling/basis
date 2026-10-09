// An all-day appointment (local midnight to the next) is a DATE in the feed, not a time at midnight.
import { describe, it, expect } from 'vitest';
import { buildIcsForEvents } from '../src/emitter.js';

describe('an all-day appointment in the feed', () => {
  it('DTSTART;VALUE=DATE and DTEND the next day', () => {
    const ics = buildIcsForEvents({ events: [{ id: 'e1', title: 'demonstratie', startsAt: new Date(2026, 10, 8).toISOString(), endsAt: new Date(2026, 10, 9).toISOString() }] });
    expect(ics).toMatch(/DTSTART;VALUE=DATE:20261108/);
    expect(ics).toMatch(/DTEND;VALUE=DATE:20261109/);
  });
  it('a timed one stays a time', () => {
    const ics = buildIcsForEvents({ events: [{ id: 'e2', title: 'kapper', startsAt: new Date(2026, 10, 8, 11).toISOString() }] });
    expect(ics).not.toMatch(/VALUE=DATE/);
  });
});
