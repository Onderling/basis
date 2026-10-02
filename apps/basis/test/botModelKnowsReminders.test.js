/**
 * The bot's model is told what its reminders really are — from the tick's own constants — and that there is no other
 * kind, so it neither denies them nor invents "an hour before and five minutes before" (the real bot, 2026-10-02). And
 * it is told the real local time, not only the date.
 */
import { describe, it, expect } from 'vitest';
import { reminderPromptLines, REMINDER_MOMENTS } from '../src/v2/botReminders.js';
import { localNow } from '../src/v2/interpretCommand.js';

describe('what the model knows of reminders and the time', () => {
  it('the moments the tick uses, the switch, and that there is no reminder at a chosen time', () => {
    const lines = reminderPromptLines().join('\n');
    expect(lines).toContain(REMINDER_MOMENTS.evening);
    expect(lines).toContain(REMINDER_MOMENTS.morning);
    expect(lines).toContain('/herinneringen');
    expect(lines).toMatch(/cannot remind at a time a person chooses/);
    // second person: the model IS the bot — told in the third person it answered "ik stuur zelf geen herinneringen"
    expect(lines).toMatch(/you \(this bot\) send them yourself/);
    expect(lines).toMatch(/shortly before it starts/);
    expect(lines).toMatch(/never promise one/);
  });

  it('the local date and time, with the weekday', () => {
    expect(localNow(Date.UTC(2026, 9, 2, 8, 5))).toMatch(/^2026-10-0[12] \d{2}:\d{2}, \w+day$/);
  });
});
