/**
 * The household's reminder before an appointment is 5 minutes by default (Frits 2026-10-05), one of 0 · 5 · 15 · 30 ·
 * 60; and the reminder tick runs every minute, so a 5-minute reminder arrives 5 minutes before — not anywhere in the
 * last five (a five-minute tick would send it between 5 and 0 minutes before, or at the start).
 */
import { describe, it, expect } from 'vitest';
import { REMINDER_LEAD_DEFAULT, REMINDER_LEAD_CHOICES } from '../src/v2/botSettings.js';
import { REMINDER_TICK_MS } from '../src/v2/botReminderTick.js';

describe('the reminder before an appointment', () => {
  it('5 minutes by default, one of the choices; the tick runs every minute', () => {
    expect(REMINDER_LEAD_DEFAULT).toBe(5);
    expect([...REMINDER_LEAD_CHOICES]).toEqual([0, 5, 15, 30, 60]);
    expect(REMINDER_TICK_MS).toBe(60_000);
  });
});
