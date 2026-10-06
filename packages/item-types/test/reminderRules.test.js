/**
 * The reminder rules are a CLOSED vocabulary of the dictionary: `morning` · `evening-before` · `before:<minutes>` ·
 * `at:<HH:MM>` — and a type that has a moment declares which field it is (its time anchor). Anything else is not a
 * rule: a new kind needs a journey that fails without it.
 */
import { describe, it, expect } from 'vitest';
import { REMINDER_RULE_KINDS, parseReminderRule, isReminderRule, TIME_ANCHORS, timeAnchorOf } from '../index.js';

describe('the reminder rules', () => {
  it('has exactly four kinds', () => {
    expect(Object.keys(REMINDER_RULE_KINDS).sort()).toEqual(['at', 'before', 'evening-before', 'morning']);
  });

  it('reads the four shapes, and nothing else', () => {
    expect(parseReminderRule('morning')).toEqual({ kind: 'morning', rule: 'morning' });
    expect(parseReminderRule('evening-before')).toEqual({ kind: 'evening-before', rule: 'evening-before' });
    expect(parseReminderRule('before:60')).toEqual({ kind: 'before', minutes: 60, rule: 'before:60' });
    expect(parseReminderRule('at:07:30')).toEqual({ kind: 'at', time: '07:30', rule: 'at:07:30' });
    for (const bad of ['', 'evening', 'before:', 'before:-5', 'before:0', 'before:100000', 'at:25:00', 'at:7:30', 'cron:0 8 * * *', null, 42]) {
      expect(parseReminderRule(bad), String(bad)).toBeNull();
      expect(isReminderRule(bad)).toBe(false);
    }
  });

  it('a type with a moment names its field: an appointment its start, a chore its due', () => {
    expect(TIME_ANCHORS).toEqual({ 'calendar-event': 'startsAt', task: 'dueAt' });
    expect(timeAnchorOf('calendar-event')).toBe('startsAt');
    expect(timeAnchorOf('note')).toBeNull();
  });
});
