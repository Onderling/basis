/**
 * Setting reminders in words. A person's own default: `/herinneringen 60` (replace), `ook avond` (add), `huis` (the
 * household's again); on/off as before. One item, their own: `remindMe` finds it by its words among what they see,
 * and writes THEIR layer only. The household's list: `/huishouden lead 15` rewrites its short notice, `rules …` the list.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';

const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const P = 'telegram:1';
const Q = 'telegram:2';

async function setup({ events = [{ id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-08T07:00:00.000Z' }] } = {}) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  const params = new Map();
  const asked = [];
  const callSkill = async (app, op, args, ctx) => {
    asked.push([app, op, ctx?.caller ?? null]);
    if (app === 'params' && op === 'set-param') { params.set(args.key, args.value); return { ok: true }; }
    if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...params].map(([key, value]) => ({ key, value })) };
    if (app === 'calendar' && op === 'listEvents') return { ok: true, items: events };
    if (app === 'lists' && op === 'listLists') return { ok: true, items: [] };
    return { ok: false };
  };
  const door = withAssistantOps({ callSkill, threads, t, admin: {} });
  return { threads, params, asked, call: (op, args, who = P) => door('assistant', op, args, { caller: who, threadId: who }) };
}

describe("a person's own reminders, in words", () => {
  it('60 replaces, "ook avond" adds, "huis" goes back to the household; on/off still switch', async () => {
    const w = await setup();
    expect((await w.call('assistant-reminders', { _match: '60' })).message).toContain('circle.bot.reminders_rules_set');
    expect(w.threads.reminderDefaultOf(P)).toEqual({ mode: 'replace', rules: ['before:60'] });
    await w.call('assistant-reminders', { _match: 'ook avond' });
    expect(w.threads.reminderDefaultOf(P)).toEqual({ mode: 'add', rules: ['evening-before'] });
    expect((await w.call('assistant-reminders', { _match: 'huis' })).message).toContain('circle.bot.reminders_rules_household');
    expect(w.threads.reminderDefaultOf(P)).toBeNull();
    await w.call('assistant-reminders', { mode: 'off' });
    expect(w.threads.remindersOn(P)).toBe(false);
    expect(w.threads.reminderDefaultOf(Q), 'nobody else').toBeNull();
  });

  it('a word it does not know sets nothing and says how', async () => {
    const w = await setup();
    const r = await w.call('assistant-reminders', { _match: '60 straks' });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).toContain('circle.bot.reminders_usage');
    expect(w.threads.reminderDefaultOf(P)).toBeNull();
  });
});

describe('remindMe: one item, their own', () => {
  it('finds the appointment by its words, as the person, and writes their layer only', async () => {
    const w = await setup();
    const r = await w.call('remindMe', { item: 'tandarts', rules: '60' });
    expect(r.ok).toBe(true);
    expect(r.message).toContain('circle.bot.remind_me_set');
    expect(w.threads.reminderExtraOf(P, 'e1')).toEqual({ mode: 'replace', rules: ['before:60'] });
    expect(w.threads.reminderExtraOf(Q, 'e1')).toBeNull();
    expect(w.asked.find(([app, op]) => app === 'calendar' && op === 'listEvents')[2], 'read as the person').toBe(P);
    await w.call('remindMe', { item: 'tandarts', rules: 'gewoon' });
    expect(w.threads.reminderExtraOf(P, 'e1')).toBeNull();
  });

  it('two that match: which one; none: said so; nothing written', async () => {
    const two = await setup({ events: [{ id: 'e1', title: 'tandarts Ann' }, { id: 'e2', title: 'tandarts Bob' }] });
    expect((await two.call('remindMe', { item: 'tandarts', rules: '60' })).message).toContain('circle.bot.remind_me_which');
    const none = await setup();
    expect(JSON.stringify(await none.call('remindMe', { item: 'kapper', rules: '60' }))).toContain('circle.bot.remind_me_not_found');
    expect(two.threads.reminderExtraIds(P)).toEqual([]);
  });
});

describe("the household's list", () => {
  it('`lead 15` rewrites its short notice in place; `rules ochtend 30` sets the list; `rules ook avond` adds', async () => {
    const w = await setup();
    await w.call('assistant-settings', { change: 'lead 15' });
    expect(w.params.get('assistant.reminderRules')).toBe('morning,evening-before,before:15');
    await w.call('assistant-settings', { change: 'rules ochtend 30' });
    expect(w.params.get('assistant.reminderRules')).toBe('morning,before:30');
    await w.call('assistant-settings', { change: 'rules ook avond' });
    expect(w.params.get('assistant.reminderRules')).toBe('morning,before:30,evening-before');
    await w.call('assistant-settings', { change: 'lead 0' });
    expect(w.params.get('assistant.reminderRules')).toBe('morning,evening-before');
  });
});
