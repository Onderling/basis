/**
 * The household's reminder before something with a time is 5 minutes by default (Frits 2026-10-05) — the `before:`
 * rule of its default list — one of 0 · 5 · 15 · 30 · 60 in the menu; and the reminder tick runs every minute, so a
 * 5-minute reminder arrives 5 minutes before — not anywhere in the last five.
 */
import { describe, it, expect } from 'vitest';
import { REMINDER_LEAD_CHOICES, HOUSEHOLD_RULES_DEFAULT } from '../src/v2/botSettings.js';
import { leadOf } from '../src/v2/reminderWords.js';
import { REMINDER_TICK_MS } from '../src/v2/botReminderTick.js';

describe('the reminder before an appointment', () => {
  it('5 minutes by default, one of the choices; the tick runs every minute', () => {
    expect(leadOf([...HOUSEHOLD_RULES_DEFAULT])).toBe(5);
    expect([...REMINDER_LEAD_CHOICES]).toEqual([0, 5, 15, 30, 60]);
    expect(REMINDER_TICK_MS).toBe(60_000);
  });
});
