/**
 * The tick: one timer on the box asks the projection what is due, says it on each person's own door as ONE message,
 * and remembers what it said (on the thread row — the only reminder state). A restart between the moment and the send
 * still sends once; a box that was off over the appointment sends nothing; the household's switch stops everyone's.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createReminderTick } from '../src/v2/botReminderTick.js';

const TZ = 'Europe/Amsterdam';
const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const people = [{ id: 'telegram:1', channel: 'telegram', uid: '1', role: 'member' }, { id: 'telegram:2', channel: 'telegram', uid: '2', role: 'member' }];
const tandarts = { id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-02T07:00:00.000Z', createdBy: 'telegram:1' };
const vuilnis = { id: 'c1', type: 'task', text: 'vuilnis', dueAt: '2026-10-01T22:00:00.000Z', assignees: ['telegram:1'] };   // Fri 2 Oct

// The device logs run on the test's clock: a log on the real clock prunes a done-mark stamped a week "ago" by retention,
// so a fixed date in the past turns this file red once real time passes it by the retention window.
function world({ now, reminders = 'on', store = memoryThreadStore(), logged = [], log = new EventLog({ initial: [], muted: [], now: () => now }) }) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [], now: () => now }), store });
  const sent = [];
  const reach = { sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; } };
  const tick = createReminderTick({
    sources: async () => ({ chores: [vuilnis], events: [tandarts] }),
    users: { list: async () => people }, threads, reach, t, tz: TZ,
    settings: () => ({ reminders, quiet: '21:00-08:00' }), now: () => now,
    onSent: (e) => logged.push(e), log,
  });
  return { threads, sent, tick, store, logged, log };
}

describe('the reminder tick', () => {
  it('at 19:05 the evening before: one message to each person in the household (the agenda is shared), the first one says how to stop; not said twice', async () => {
    const w = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime() });
    await w.threads.load();
    await w.tick.pass();
    const first = w.sent.length;
    expect(first).toBeGreaterThanOrEqual(1);
    expect(new Set(w.sent.map((m) => m.id)).size, 'one message per person').toBe(first);
    const maker = w.sent.find((m) => m.id === 'telegram:1');
    expect(maker.text).toContain('circle.bot.reminder_event');
    expect(maker.text).toContain('"time":"09:00"');
    expect(maker.text).toContain('circle.bot.reminder_first');
    await w.tick.pass();
    expect(w.sent).toHaveLength(first);
  });

  it('a restart between the moment and the send still sends once', async () => {
    const store = memoryThreadStore();
    // the device log survives the restart, as the box's does (sealed on disk)
    let clock = new Date('2026-10-01T17:05:00.000Z').getTime();
    const log = new EventLog({ initial: [], muted: [], now: () => clock });
    const before = world({ now: clock, store, log });
    await before.threads.load();
    await before.tick.pass();
    await new Promise((r) => setTimeout(r, 10));   // the thread row reaches its store
    clock = new Date('2026-10-01T17:35:00.000Z').getTime();
    const after = world({ now: clock, store, log });
    await after.threads.load();
    await after.tick.pass();
    // each person once, whichever side of the restart
    const ids = [...before.sent, ...after.sent].map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it('what was said is a done-mark per person per occurrence on the device log — not a slot on the thread row', async () => {
    const w = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime() });
    await w.threads.load();
    await w.tick.pass();
    const marks = w.log.query({ filter: { type: 'intention-done' } }).map((e) => e.payload.occurrence).sort();
    expect(marks).toEqual(people.map((p) => `e1:evening-before:2026-10-01:${p.id}`).sort());
    expect(w.threads.saidOf('telegram:1')).toEqual({});
  });

  it('a slot a thread row still holds from before the marks is not said again', async () => {
    const w = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime() });
    await w.threads.load();
    for (const p of people) w.threads.setSaid(p.id, { e1: '2026-10-01:evening' });
    await w.tick.pass();
    expect(w.sent).toEqual([]);
  });

  it('the morning after, the chore due that day; a box off over the appointment says nothing of it', async () => {
    const w = world({ now: new Date('2026-10-02T09:00:00.000Z').getTime() });   // Fri 11:00, the appointment has begun
    await w.threads.load();
    await w.tick.pass();
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain('circle.bot.reminder_chore');
    expect(w.sent[0].text).not.toContain('tandarts');
    expect(w.sent[0].buttons).toEqual([expect.objectContaining({ id: 'completeTask:c1' })]);
  });

  it('today\'s appointment: the morning message, then ONE short notice — never the two in turn every minute (live 2026-10-07)', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const sent = [];
    let at = Date.parse('2026-10-08T06:00:00Z');   // Thu 08:00 in Amsterdam
    const dentist = { id: 'e9', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-08T12:00:00.000Z', createdBy: 'telegram:1', createdAt: '2026-10-07T10:00:00.000Z' };
    const tick = createReminderTick({
      sources: async () => ({ chores: [], events: [dentist] }),
      users: { list: async () => [people[0]] }, threads, t, tz: TZ,
      reach: { sendToPerson: async (id, m) => { sent.push(m.text.split('\n')[0].split(' ')[0]); return { ok: true }; } },
      settings: () => ({ reminders: 'on', quiet: '21:00-08:00', lead: 5 }), now: () => at,
    });
    await tick.pass();                                                   // 08:00: the morning message
    for (const minute of [55, 56, 57, 58, 59]) { at = Date.parse('2026-10-08T11:00:00Z') + minute * 60_000; await tick.pass(); }   // 13:55–13:59
    expect(sent).toEqual(['circle.bot.reminder_event', 'circle.bot.reminder_event_soon']);
  });

  it('the household\'s switch off: nothing for anyone', async () => {
    const w = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime(), reminders: 'off' });
    await w.threads.load();
    await w.tick.pass();
    expect(w.sent).toEqual([]);
  });

  it('the Sunday overview is no longer the tick\'s: it is a planned row the runner sends (weekOverviewRows)', async () => {
    const sunday = new Date('2026-10-04T16:05:00.000Z').getTime();   // Sun 4 Oct, 18:05 local
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    threads.setOverview('telegram:2', true);
    const sent = [];
    const tick = createReminderTick({
      sources: async () => ({ chores: [], events: [] }),
      users: { list: async () => people }, threads, t, tz: TZ,
      reach: { sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; } },
      settings: () => ({ reminders: 'on', quiet: '21:00-08:00' }), now: () => sunday,
    });
    await tick.pass();
    expect(sent).toEqual([]);
  });

  it('a person on a door without buttons (the inbox) is told in words how to tick it off', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const sent = [];
    const webPerson = { id: 'webid:ann', channel: 'web', uid: 'webid:ann', role: 'member' };
    const tick = createReminderTick({
      sources: async () => ({ chores: [{ ...vuilnis, assignees: ['webid:ann'] }], events: [] }),
      users: { list: async () => [webPerson] }, threads, t, tz: TZ,
      reach: { sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; } },
      settings: () => ({ reminders: 'on', quiet: '21:00-08:00' }), now: () => new Date('2026-10-02T09:00:00.000Z').getTime(),
    });
    await tick.pass();
    expect(sent[0].text).toContain('circle.bot.reminder_done_words');
    expect(sent[0].text).toContain('vuilnis');
  });

  it('the log line says WHEN, WHICH item and WHICH kind — a reminder that did not come can be traced', async () => {
    const w = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime() });
    await w.threads.load();
    await w.tick.pass();
    const e = w.logged.find((x) => x.personId === 'telegram:1');
    expect(e.at).toBe('2026-10-01T17:05:00.000Z');
    expect(e.what).toEqual([expect.objectContaining({ kind: 'event', id: 'e1', slot: '2026-10-01:evening' })]);
  });
});
