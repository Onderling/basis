/**
 * `/gepland` — what the bot will send THIS person in the coming week (J5): their reminders, as their layers make them,
 * and their planned rows (the Sunday overview), in time order; a row that was missed says so (J6). An admin also sees
 * the household's own rules — never anyone's personal extras. Read from the record, nothing stored for it.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { WEEK_OVERVIEW_ROW } from '../src/v2/weekOverviewRows.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const TZ = 'Europe/Amsterdam';
const ANNE = 'telegram:1';
const BERT = 'telegram:2';
// Wed 7 Oct 10:00; the tandarts Thu 8 Oct 14:00, for everyone
const NOW = Date.parse('2026-10-07T08:00:00Z');
const tandarts = { id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-08T12:00:00.000Z', createdBy: ANNE, createdAt: '2026-10-01T10:00:00.000Z' };

async function setup({ role = 'member' } = {}) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const store = createOwnDevicesStore({ dataSource: memoryDataSource() });
  const book = createIntentionBook({ store, actor: 'bot', now: () => Date.parse('2026-10-01T10:00:00Z') });
  await book.load();
  const params = new Map([['assistant.reminderRules', 'morning,evening-before,before:5']]);
  const callSkill = async (app, op) => (app === 'params' && op === 'list-user-params' ? { ok: true, params: [...params].map(([key, value]) => ({ key, value })) } : { ok: true });
  const rows = [{ id: ANNE, role }, { id: BERT, role: 'member' }];
  const door = withAssistantOps({
    callSkill, threads, t, now: () => NOW,
    intentions: { book, tz: TZ, sources: async () => ({ events: [tandarts], chores: [] }), users: async () => rows },
  });
  return { threads, book, store, call: (who = ANNE) => door('assistant', 'assistant-planned', {}, { caller: who, threadId: who }) };
}

describe('/gepland', () => {
  it('their reminders in time order, as their own layer makes them — another person\'s extras never', async () => {
    const w = await setup();
    w.threads.setReminderDefault(ANNE, { mode: 'add', rules: ['before:60'] });
    w.threads.setReminderExtra(BERT, 'e1', { mode: 'add', rules: ['at:07:00'] });
    const r = await w.call();
    expect(r.ok).toBe(true);
    const lines = r.message.split('\n').filter((l) => l.includes('tandarts'));
    // Thu 08:00 morning · 13:00 an hour before (theirs) · 13:55 the household's five minutes — not Bert's 07:00
    expect(lines.map((l) => (l.match(/rule_(\w+)/) ?? [])[1])).toEqual(['morning', 'before', 'before']);
    expect(r.message).not.toContain('"time":"07:00"');
  });

  it('their Sunday overview row is listed; one missed says so', async () => {
    const w = await setup();
    // the row was made a week ago (switched on before last Sunday)
    await w.store.put({ ...WEEK_OVERVIEW_ROW, trigger: { ...WEEK_OVERVIEW_ROW.trigger }, args: {}, type: 'intention', id: 'row-anne', actsAs: ANNE, state: 'open', createdAt: '2026-10-01T10:00:00.000Z' }, { by: 'bot' });
    await w.book.load();
    const r = await w.call();
    expect(r.message).toContain('circle.bot.planned_week_overview');
    // the Sunday before (4 Oct) was missed: its window was that day
    expect(r.message).toContain('circle.bot.planned_skipped');
  });

  it('an admin also sees the household\'s rules; a member does not', async () => {
    expect((await (await setup()).call()).message).not.toContain('circle.bot.planned_household');
    expect((await (await setup({ role: 'admin' })).call()).message).toContain('circle.bot.planned_household');
  });

  it('nothing coming: said so', async () => {
    const w = await setup();
    w.threads.setReminders(ANNE, false);
    const r = await w.call();
    expect(r.message).toContain('circle.bot.planned_reminders_off');
  });
});

describe('/gepland and the household\'s announce rows', () => {
  it('says which changes the bot tells people about; a switched-off kind is left out; none at all says so', async () => {
    const { seedAnnounceRows } = await import('../src/v2/announceRows.js');
    const { createCircleStores } = await import('@onderling/item-store');
    const { validate } = await import('@onderling/item-types');
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const home = createCircleStores({ dataSource: memoryDataSource(), registry: { validate } }).getStore('c-home');
    const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), circles: async () => [{ scope: 'c-home', store: home }], actor: 'bot' });
    await book.load();
    const callSkill = async () => ({ ok: true, params: [] });
    const door = withAssistantOps({ callSkill, threads, t, now: () => NOW, intentions: { book, tz: TZ, sources: async () => ({ events: [], chores: [] }), users: async () => [{ id: ANNE, role: 'member' }] } });
    const call = async () => (await door('assistant', 'assistant-planned', {}, { caller: ANNE, threadId: ANNE })).message;
    await seedAnnounceRows(book, 'c-home');
    expect(await call()).toContain('circle.bot.planned_announce {"which":"circle.bot.planned_announce_appointments, circle.bot.planned_announce_chores"}');
    await book.cancel(book.rows().find((r) => r.label === 'announce-chores').id);
    expect(await call()).toContain('circle.bot.planned_announce {"which":"circle.bot.planned_announce_appointments"}');
    await book.cancel(book.rows().find((r) => r.label === 'announce-appointments').id);
    expect(await call()).toContain('circle.bot.planned_announce_none');
  });
});
