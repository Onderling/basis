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
const tandarts = { id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-02T08:00:00.000Z', createdBy: 'telegram:1' };
const vuilnis = { id: 'c1', type: 'task', text: 'vuilnis', dueAt: '2026-10-01T22:00:00.000Z', assignees: ['telegram:1'] };   // Fri 2 Oct

function world({ now, reminders = 'on', store = memoryThreadStore() }) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store });
  const sent = [];
  const reach = { sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; } };
  const tick = createReminderTick({
    sources: async () => ({ chores: [vuilnis], events: [tandarts] }),
    users: { list: async () => people }, threads, reach, t, tz: TZ,
    settings: () => ({ reminders, quiet: '21:00-08:00' }), now: () => now,
  });
  return { threads, sent, tick, store };
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
    expect(maker.text).toContain('"time":"10:00"');
    expect(maker.text).toContain('circle.bot.reminder_first');
    await w.tick.pass();
    expect(w.sent).toHaveLength(first);
  });

  it('a restart between the moment and the send still sends once', async () => {
    const store = memoryThreadStore();
    const before = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime(), store });
    await before.threads.load();
    await before.tick.pass();
    await new Promise((r) => setTimeout(r, 10));   // the thread row reaches its store
    const after = world({ now: new Date('2026-10-01T17:35:00.000Z').getTime(), store });
    await after.threads.load();
    await after.tick.pass();
    // each person once, whichever side of the restart
    const ids = [...before.sent, ...after.sent].map((m) => m.id);
    expect(ids.length).toBe(new Set(ids).size);
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

  it('the household\'s switch off: nothing for anyone', async () => {
    const w = world({ now: new Date('2026-10-01T17:05:00.000Z').getTime(), reminders: 'off' });
    await w.threads.load();
    await w.tick.pass();
    expect(w.sent).toEqual([]);
  });

  it('Sunday 18:00: the week overview, as the person, only to those who switched it on — once a week', async () => {
    const sunday = new Date('2026-10-04T16:05:00.000Z').getTime();   // Sun 4 Oct, 18:05 local
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    threads.setOverview('telegram:2', true);
    const sent = [];
    const asked = [];
    const tick = createReminderTick({
      sources: async () => ({ chores: [], events: [] }),
      users: { list: async () => people }, threads, t, tz: TZ,
      reach: { sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; } },
      settings: () => ({ reminders: 'on', quiet: '21:00-08:00' }), now: () => sunday,
      overviewFor: async (id) => { asked.push(id); return `Deze week voor ${id}`; },
    });
    await tick.pass();
    expect(asked).toEqual(['telegram:2']);
    expect(sent).toEqual([expect.objectContaining({ id: 'telegram:2', text: 'Deze week voor telegram:2' })]);
    await tick.pass();
    expect(sent).toHaveLength(1);
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
});
