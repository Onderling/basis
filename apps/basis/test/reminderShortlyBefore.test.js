/**
 * A reminder shortly before an appointment (Fable's design for what Frits hit on 2026-10-02: two appointments made
 * that morning for 10:05 and 10:10 were never reminded — the only moment was the evening before). A second slot per
 * appointment, `<date>:soon`, due from `start − lead` to the start; the same people as the evening slot; never in quiet
 * hours; not when the appointment was made less than the lead before its start; `assistant.reminderLeadMin` (0 = off).
 */
import { describe, it, expect } from 'vitest';
import { dueReminders } from '../src/v2/botReminders.js';

const TZ = 'Europe/Amsterdam';
const at = (iso) => new Date(iso).getTime();
// 2026-10-02 is summer time: local = UTC + 2
const local = (hhmm) => at(`2026-10-02T${String(Number(hhmm.slice(0, 2)) - 2).padStart(2, '0')}:${hhmm.slice(3)}:00.000Z`);
const ev = (id, start, created, extra = {}) => ({ id, title: id, startsAt: new Date(local(start)).toISOString(), createdAt: new Date(local(created)).toISOString(), createdBy: 'frits', ...extra });
const people = [{ id: 'frits', role: 'admin' }, { id: 'ann', role: 'observer' }, { id: 'bert', role: 'member', remindersOff: true }];
const soon = (events, now, extra = {}) => dueReminders({ events, people, now: local(now), tz: TZ, lead: 30, ...extra });

describe('a reminder shortly before an appointment', () => {
  it('10:05 and 10:10 made at 09:00: one message, two lines, at 09:35–09:40', () => {
    const events = [ev('sperzieboontjes', '10:05', '09:00'), ev('aardbeitjes', '10:10', '09:00')];
    expect(soon(events, '09:30')).toEqual([]);
    const due = soon(events, '09:40');
    expect(due).toHaveLength(1);
    expect(due[0].personId).toBe('frits');
    expect(due[0].items.map((i) => [i.id, i.slot, i.soon])).toEqual([['sperzieboontjes', '2026-10-02:soon', true], ['aardbeitjes', '2026-10-02:soon', true]]);
    // said once: not again in the next pass
    const said = { frits: { sperzieboontjes: '2026-10-02:soon', aardbeitjes: '2026-10-02:soon' } };
    expect(soon(events, '09:45', { said })).toEqual([]);
  });

  it('made less than the lead before its start: none; moved: the new time; cancelled: none', () => {
    expect(soon([ev('late', '10:05', '09:50')], '09:55')).toEqual([]);
    const moved = ev('moved', '11:00', '09:00');
    expect(soon([moved], '09:40')).toEqual([]);
    expect(soon([moved], '10:35')[0].items[0]).toMatchObject({ id: 'moved', soon: true });
    expect(soon([ev('gone', '10:05', '09:00', { state: 'cancelled' })], '09:40')).toEqual([]);
  });

  it('not in quiet hours; lead 0 is off; an observer and a person with reminders off get none', () => {
    expect(soon([ev('early', '07:30', '06:00')], '07:05')).toEqual([]);   // quiet until 08:00
    expect(soon([ev('off', '10:05', '09:00')], '09:40', { lead: 0 })).toEqual([]);
    const shared = ev('shared', '10:05', '09:00', { rsvp: { ann: 'accepted', bert: 'accepted' } });
    expect(soon([shared], '09:40').map((d) => d.personId)).toEqual(['frits']);
  });
});

describe('the tick says it', () => {
  it('with the household\'s lead: one message, both appointments, in Fable\'s words; lead 0 says nothing', async () => {
    const { createReminderTick } = await import('../src/v2/botReminderTick.js');
    const { createBotThreads, memoryThreadStore } = await import('../src/v2/botThreads.js');
    const { EventLog } = await import('../src/eventLog.js');
    const run = async (lead) => {
      const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
      const sent = [];
      const tick = createReminderTick({
        sources: async () => ({ chores: [], events: [ev('sperzieboontjes', '10:05', '09:00'), ev('aardbeitjes', '10:10', '09:00')] }),
        users: { list: async () => [{ id: 'frits', channel: 'telegram', uid: '1', role: 'admin' }] }, threads,
        reach: { sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; } },
        t: (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k), tz: TZ,
        settings: () => ({ reminders: 'on', quiet: '21:00-08:00', lead }), now: () => local('09:40'),
      });
      await tick.pass();
      return sent;
    };
    const sent = await run(30);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('circle.bot.reminder_event_soon {"title":"sperzieboontjes","time":"10:05"}');
    expect(sent[0].text).toContain('circle.bot.reminder_event_soon {"title":"aardbeitjes","time":"10:10"}');
    expect(await run(0)).toEqual([]);
  });
});
