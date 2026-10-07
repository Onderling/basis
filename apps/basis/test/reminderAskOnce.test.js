/**
 * The question, once per person (Fable's answer): at their first dated add, when they have no reminders of their own,
 * the reply asks with four buttons — Ochtend · 1 uur van tevoren · Geen · Zoals altijd — each a `/herinneringen` of
 * its own. After that never unprompted: `/herinneringen` and the menu change it. Not for an add without a date, not
 * for someone who already chose.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const P = 'telegram:1';

async function setup() {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const callSkill = async () => ({ ok: true, message: 'circle.calendar.added' });
  const door = withAssistantOps({ callSkill, threads, t });
  return { threads, door, call: (app, op, args, who = P) => door(app, op, args, { caller: who, threadId: who }) };
}

describe('the reminder question, once', () => {
  it('the first dated add asks, with the four buttons; the second does not', async () => {
    const w = await setup();
    const first = await w.call('calendar', 'addEvent', { title: 'tandarts', when: '2026-10-09T09:00' });
    expect(first.message).toContain('circle.calendar.added');
    expect(first.message).toContain('circle.bot.reminders_ask');
    expect(first.quickReplies.map((b) => b.slash)).toEqual(['/herinneringen ochtend', '/herinneringen 60', '/herinneringen geen', '/herinneringen huis']);
    const second = await w.call('calendar', 'addEvent', { title: 'kapper', when: '2026-10-10T09:00' });
    expect(second.message).not.toContain('circle.bot.reminders_ask');
    expect(second.quickReplies ?? []).toEqual([]);
  });

  it('not for an add without a date; a chore with a due asks', async () => {
    const w = await setup();
    expect((await w.call('lists', 'addToList', { list: 'Boodschappen', text: 'melk' })).message).not.toContain('circle.bot.reminders_ask');
    expect((await w.call('lists', 'addToList', { list: 'Klusjes', text: 'vuilnis', due: 'morgen' })).message).toContain('circle.bot.reminders_ask');
  });

  it('someone who already chose their own is never asked', async () => {
    const w = await setup();
    w.threads.setReminderDefault(P, { mode: 'replace', rules: ['before:60'] });
    expect((await w.call('calendar', 'addEvent', { title: 'tandarts', when: '2026-10-09T09:00' })).message).not.toContain('circle.bot.reminders_ask');
  });

  it('a refused add asks nothing', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const door = withAssistantOps({ callSkill: async () => ({ ok: false, error: 'no' }), threads, t });
    const r = await door('calendar', 'addEvent', { title: 'x', when: '2026-10-09T09:00' }, { caller: P, threadId: P });
    expect(JSON.stringify(r)).not.toContain('reminders_ask');
    expect(threads.reminderAskedOf(P)).toBe(false);
  });
});
