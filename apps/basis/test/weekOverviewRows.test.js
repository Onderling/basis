/**
 * The Sunday week overview as planned work: `/overzicht aan` writes ONE row in the own-devices store (every Sunday
 * 18:00, `sendWeekOverview`, as that person); `uit` cancels it; the setting reads the row. The op delivers its own
 * result to the person's own door, and in their quiet hours it is "not yet". A person whose thread row still carries
 * the old switch gets their row at boot, once. And through the runner, on a Sunday evening, it reaches them once.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createOwnDevicesStore } from '../src/v2/ownDevicesStore.js';
import { createIntentionBook } from '../src/v2/intentionBook.js';
import { createIntentionRunner } from '../src/v2/intentionRunner.js';
import { WEEK_OVERVIEW_OP, moveOverviewSwitchesToRows } from '../src/v2/weekOverviewRows.js';

const TZ = 'Europe/Amsterdam';
const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const P = 'telegram:111';

async function setup({ now = Date.parse('2026-10-05T10:00:00Z'), quiet = null } = {}) {
  let at = now;
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const book = createIntentionBook({ store: createOwnDevicesStore({ dataSource: memoryDataSource() }), actor: 'bot', now: () => at });
  await book.load();
  const sent = [];
  // the household's chores and appointments, read by the overview as the person
  const callSkill = async (app, op) => (op === 'listLists' ? { ok: true, lists: [] } : op === 'listEvents' ? { ok: true, events: [] } : op === 'listMine' ? { ok: true, items: [] } : { ok: true });
  const door = withAssistantOps({
    callSkill, threads, t, now: () => at,
    intentions: { book, sendToPerson: async (id, m) => { sent.push({ id, ...m }); return { ok: true }; }, quietOf: () => quiet, tz: TZ },
  });
  return { threads, book, door, sent, setNow: (x) => { at = x; }, now: () => at };
}

describe('the week overview as a planned row', () => {
  it('/overzicht aan writes one row (Sunday 18:00, as the person); asked twice still one; uit cancels it', async () => {
    const w = await setup();
    expect((await w.door('assistant', 'assistant-overview', { mode: 'aan' }, { threadId: P })).ok).toBe(true);
    await w.door('assistant', 'assistant-overview', { mode: 'on' }, { threadId: P });
    const open = w.book.openFor(P, WEEK_OVERVIEW_OP);
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ trigger: { every: 'week', on: 'sun', at: '18:00' }, appOrigin: 'assistant', actsAs: P });
    await w.door('assistant', 'assistant-overview', { mode: 'uit' }, { threadId: P });
    expect(w.book.openFor(P, WEEK_OVERVIEW_OP)).toEqual([]);
  });

  it('the setting shows how it stands from the row, not from the thread', async () => {
    const w = await setup();
    const ticked = async () => (await w.door('assistant', 'assistant-overview', {}, { threadId: P })).quickReplies.find((q) => q.label.endsWith(' ✓'))?.label;
    expect(await ticked()).toMatch(/value_off/);
    await w.door('assistant', 'assistant-overview', { mode: 'on' }, { threadId: P });
    expect(await ticked()).toMatch(/value_on/);
    expect(w.threads.overviewOn(P), 'the thread row is no longer where it is kept').toBe(false);
    expect(w.book.openFor(P, WEEK_OVERVIEW_OP)).toHaveLength(1);
  });

  it('sendWeekOverview delivers the overview to the person\'s own door; in their quiet hours it is not yet', async () => {
    const w = await setup();
    expect(await w.door('assistant', WEEK_OVERVIEW_OP, {}, { caller: P, threadId: P })).toEqual({ ok: true });
    expect(w.sent).toEqual([expect.objectContaining({ id: P, text: expect.stringContaining('circle.bot.overview_head') })]);
    const q = await setup({ quiet: '00:00-23:59' });
    expect(await q.door('assistant', WEEK_OVERVIEW_OP, {}, { caller: P, threadId: P })).toEqual({ ok: false, notYet: 'quiet' });
    expect(q.sent).toEqual([]);
  });

  it('the old switch on a thread row becomes a row at boot, once, and the thread row lets go of it', async () => {
    const w = await setup();
    w.threads.setOverview(P, true);
    const users = { list: async () => [{ id: P }, { id: 'telegram:222' }] };
    expect(await moveOverviewSwitchesToRows({ threads: w.threads, users, book: w.book })).toBe(1);
    expect(await moveOverviewSwitchesToRows({ threads: w.threads, users, book: w.book })).toBe(0);
    expect(w.book.openFor(P, WEEK_OVERVIEW_OP)).toHaveLength(1);
    expect(w.threads.overviewOn(P)).toBe(false);
  });

  it('through the runner: on Sunday evening the overview reaches the person once', async () => {
    const w = await setup();
    await w.door('assistant', 'assistant-overview', { mode: 'on' }, { threadId: P });
    const runner = createIntentionRunner({
      book: w.book, log: new EventLog({ initial: [], muted: [] }), tz: TZ, now: w.now,
      run: (o) => w.door(o.appOrigin, o.op, { ...o.args, occurrence: o.id }, { caller: o.actsAs, threadId: o.actsAs }),
    });
    w.setNow(Date.parse('2026-10-11T15:00:00Z'));   // Sunday 17:00
    await runner.pass();
    expect(w.sent).toEqual([]);
    w.setNow(Date.parse('2026-10-11T16:30:00Z'));   // Sunday 18:30
    await runner.pass();
    await runner.pass();
    expect(w.sent.map((m) => m.id)).toEqual([P]);
  });
});
