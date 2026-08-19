/**
 * The retention SETTING — one control, honestly scoped.
 *
 * The mechanism is per-kind (eventLog.test.js covers the classes + audit compaction). This covers the
 * setting's own promises: it governs the chat window, plumbing never outlives the conversation, the
 * audit window follows as a DETAIL window (compaction, not deletion), and a nonsense stored value
 * lands on the decided default rather than on "keep forever" or "keep nothing".
 */
import { describe, it, expect } from 'vitest';
import {
  RETENTION_CHOICES_DAYS, DEFAULT_RETENTION_DAYS,
  normalizeRetentionDays, retentionFromDays, daysToMs,
} from '../../src/v2/retentionPref.js';
import { EventLog } from '../../src/eventLog.js';

describe('the choice', () => {
  it('offers the four windows and defaults to the decided 14 days', () => {
    expect(RETENTION_CHOICES_DAYS).toEqual([7, 14, 30, 90]);
    expect(DEFAULT_RETENTION_DAYS).toBe(14);
  });

  it('a value the user never gave falls back to the default — not to forever, not to nothing', () => {
    for (const junk of [undefined, null, 0, -1, 3, 9999, 'lots', {}, NaN]) {
      expect(normalizeRetentionDays(junk)).toBe(DEFAULT_RETENTION_DAYS);
    }
    expect(normalizeRetentionDays('30')).toBe(30);   // a stored string still resolves
  });
});

describe('what one control governs', () => {
  it('chat gets the chosen window', () => {
    expect(retentionFromDays(30).chat).toBe(daysToMs(30));
  });

  it('plumbing never outlives the conversation it describes', () => {
    // 7-day default cap, and shorter still when the user picks less.
    expect(retentionFromDays(90).short).toBe(daysToMs(7));
    expect(retentionFromDays(7).short).toBe(daysToMs(7));
    const short = retentionFromDays(7).short;
    expect(short).toBeLessThanOrEqual(retentionFromDays(7).chat);
  });

  it('audit follows as the DETAIL window — past it entries compact, they do not vanish', () => {
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: retentionFromDays(7) });
    log.append({ id: 'g1', ts: 0, app: 'system', type: 'governance', circleId: 'c1', payload: { event: 'propose' } });
    log.append({ id: 'm1', ts: 0, app: 'circle', type: 'ask', payload: { text: 'hoi' } });
    clock = daysToMs(8);
    log.prune();
    const rows = log.query();
    expect(rows.map((e) => e.id)).not.toContain('m1');            // chat-class content is gone
    expect(rows.map((e) => e.id)).not.toContain('g1');            // the detail is gone…
    const summary = rows.find((e) => e.type === 'audit-summary');
    expect(summary.payload.foldedCount).toBe(1);                  // …but it is COUNTED, not forgotten
  });

  it('the conversation RECORD is not governed by the setting — chat messages survive every window', () => {
    // Since the chat-lane sitting, chat-message is RECORD class: the log is the conversation's record, so
    // the retention control governs the windowed content classes, never the record itself. (Whether a
    // user keeps a separate, explicitly-destructive "delete old chat" control is an open design call.)
    let clock = 0;
    const log = new EventLog({ now: () => clock, retention: retentionFromDays(7) });
    log.append({ id: 'msg', ts: 0, app: 'circle', type: 'chat-message', payload: { text: 'hoi' } });
    clock = daysToMs(100);
    log.prune();
    expect(log.query().map((e) => e.id)).toContain('msg');
  });
});

describe('applying the choice live', () => {
  it('setRetention prunes immediately, so a shortened window shows in the open conversation', () => {
    let clock = daysToMs(20);
    const log = new EventLog({ now: () => clock, retention: retentionFromDays(30) });
    log.append({ id: 'm1', ts: daysToMs(1), app: 'circle', type: 'ask', payload: { text: 'oud' } });
    expect(log.query()).toHaveLength(1);

    const dropped = log.setRetention(retentionFromDays(7));
    expect(dropped).toBe(1);
    expect(log.query()).toHaveLength(0);
  });

  it('lengthening the window drops nothing (it cannot bring anything back either)', () => {
    let clock = daysToMs(20);
    const log = new EventLog({ now: () => clock, retention: retentionFromDays(30) });
    log.append({ id: 'm1', ts: daysToMs(19), app: 'circle', type: 'chat-message', payload: { text: 'recent' } });
    expect(log.setRetention(retentionFromDays(90))).toBe(0);
    expect(log.query()).toHaveLength(1);
  });
});

// (persistence tests removed 2026-08-10 with `localStorageRetentionIo` — retention now persists through the
// parameter register's set-param op; the register's own round-trip is covered by the params tests + journeys.)
