/**
 * What a change tells OTHERS, at once (Fable's answer, the reminders brief): a new appointment for everyone or for
 * named people → those people; a chore GIVEN to someone → them; a cancel or a move → the same people, saying what
 * changed; never the one who did it; an edit of words only → nobody. Each announcement has its own id
 * (`announce:<item>:<kind>:<moment>:<person>`), so one change is said once per person — and a second move is a new one.
 */
import { describe, it, expect } from 'vitest';
import { announcementsFor } from '../src/v2/announcements.js';

const people = [{ id: 'telegram:1' }, { id: 'telegram:2' }, { id: 'telegram:3' }];
const NOW = Date.parse('2026-10-07T10:00:00Z');
const ev = (over = {}) => ({ id: 'e1', type: 'calendar-event', title: 'tandarts', startsAt: '2026-10-09T07:00:00.000Z', createdBy: 'telegram:1', ...over });
const chore = (over = {}) => ({ id: 'c1', type: 'task', text: 'vuilnis', assignees: [], ...over });
const run = (before, after, maker = 'telegram:1') => announcementsFor({ before: { events: before.events ?? [], chores: before.chores ?? [] }, after: { events: after.events ?? [], chores: after.chores ?? [] }, people, maker, now: NOW });
const who = (list) => list.map((a) => `${a.kind}:${a.personId}`).sort();

describe('announcements', () => {
  it('a new appointment for everyone: everyone but its maker', () => {
    const out = run({}, { events: [ev()] });
    expect(who(out)).toEqual(['new:telegram:2', 'new:telegram:3']);
    expect(out[0]).toMatchObject({ itemId: 'e1', itemKind: 'event', text: 'tandarts', at: '2026-10-09T07:00:00.000Z' });
    expect(out[0].id).toBe(`announce:e1:new:2026-10-09T07:00:00.000Z:${out[0].personId}`);
  });

  it('one that names people: those (and nobody else)', () => {
    expect(who(run({}, { events: [ev({ attendees: ['telegram:3'] })] }))).toEqual(['new:telegram:3']);
  });

  it('cancelled: the people it was for; moved: once, with the new time — a second move is a second announcement', () => {
    expect(who(run({ events: [ev()] }, { events: [ev({ state: 'cancelled' })] }))).toEqual(['cancelled:telegram:2', 'cancelled:telegram:3']);
    const moved = run({ events: [ev()] }, { events: [ev({ startsAt: '2026-10-09T13:00:00.000Z' })] }, 'telegram:2');
    expect(who(moved)).toEqual(['moved:telegram:1', 'moved:telegram:3']);
    const again = run({ events: [ev({ startsAt: '2026-10-09T13:00:00.000Z' })] }, { events: [ev({ startsAt: '2026-10-09T14:00:00.000Z' })] }, 'telegram:2');
    expect(again[0].id).not.toBe(moved[0].id);
  });

  it('a chore given to someone: them; given by themselves (claimed): nobody; a due moved: its holders', () => {
    expect(who(run({ chores: [chore()] }, { chores: [chore({ assignees: ['telegram:2'] })] }))).toEqual(['given:telegram:2']);
    expect(who(run({}, { chores: [chore({ assignees: ['telegram:3'], dueAt: '2026-10-08T22:00:00.000Z' })] }))).toEqual(['given:telegram:3']);
    expect(run({ chores: [chore()] }, { chores: [chore({ assignees: ['telegram:1'] })] })).toEqual([]);
    expect(who(run({ chores: [chore({ assignees: ['telegram:2'], dueAt: '2026-10-08T22:00:00.000Z' })] }, { chores: [chore({ assignees: ['telegram:2'], dueAt: '2026-10-09T22:00:00.000Z' })] }))).toEqual(['moved:telegram:2']);
  });

  it('words only, a done chore, or something already past: nobody', () => {
    expect(run({ events: [ev()] }, { events: [ev({ title: 'tandarts Ann' })] })).toEqual([]);
    expect(run({ chores: [chore({ assignees: ['telegram:2'] })] }, { chores: [chore({ assignees: ['telegram:2'], completedAt: NOW })] })).toEqual([]);
    expect(run({}, { events: [ev({ startsAt: '2026-10-01T07:00:00.000Z' })] })).toEqual([]);
  });
});

describe('the announcer: at once, held through quiet hours, said once', async () => {
  const { EventLog } = await import('../src/eventLog.js');
  const { createBotThreads, memoryThreadStore } = await import('../src/v2/botThreads.js');
  const { createAnnouncer } = await import('../src/v2/announcements.js');
  const { createReminderTick } = await import('../src/v2/botReminderTick.js');
  const TZ = 'Europe/Amsterdam';
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  const rows = [{ id: 'telegram:1', role: 'member' }, { id: 'telegram:2', role: 'member' }, { id: 'telegram:3', role: 'member' }];

  async function world() {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    threads.setQuiet('telegram:3', '09:00-12:00');   // telegram:3 is in quiet hours at 10:00
    const log = new EventLog({ initial: [], muted: [] });
    let at = Date.parse('2026-10-07T08:00:00Z');   // Wed 10:00
    let household = { events: [], chores: [] };
    const sent = [];
    const reach = { sendToPerson: async (id, m) => { sent.push({ id, text: m.text }); return { ok: true }; } };
    const announcer = createAnnouncer({ sources: async () => household, users: { list: async () => rows }, threads, reach, t, tz: TZ, quiet: () => '23:00-07:00', log, now: () => at });
    const tick = createReminderTick({ sources: async () => household, users: { list: async () => rows }, threads, reach, t, tz: TZ, settings: () => ({ reminders: 'on', quiet: '23:00-07:00', rules: [] }), now: () => at, log, announcer });
    const add = (e) => announcer.around(async () => { household = { ...household, events: [...household.events, e] }; return { ok: true }; }, { caller: 'telegram:1' });
    return { threads, sent, add, tick, announcer, setNow: (iso) => { at = Date.parse(iso); } };
  }

  it('the others reachable now hear it at once; the maker does not; one in quiet hours is held', async () => {
    const w = await world();
    await w.add({ id: 'e9', type: 'calendar-event', title: 'kapper', startsAt: '2026-10-09T12:00:00.000Z', createdBy: 'telegram:1' });
    expect(w.sent.map((m) => m.id)).toEqual(['telegram:2']);
    expect(w.sent[0].text).toContain('circle.bot.announce_new');
    expect(w.threads.heldAnnouncementsOf('telegram:3')).toHaveLength(1);
  });

  it('held, it comes when their quiet hours end — once', async () => {
    const w = await world();
    await w.add({ id: 'e9', type: 'calendar-event', title: 'kapper', startsAt: '2026-10-09T12:00:00.000Z', createdBy: 'telegram:1' });
    w.setNow('2026-10-07T09:30:00Z');   // 11:30, still quiet for telegram:3
    await w.tick.pass();
    expect(w.sent.filter((m) => m.id === 'telegram:3')).toEqual([]);
    w.setNow('2026-10-07T10:05:00Z');   // 12:05
    await w.tick.pass();
    await w.tick.pass();
    const theirs = w.sent.filter((m) => m.id === 'telegram:3');
    expect(theirs).toHaveLength(1);
    expect(theirs[0].text).toContain('circle.bot.announce_new');
    expect(w.threads.heldAnnouncementsOf('telegram:3')).toEqual([]);
  });

  it('the same change through a second door call is not said twice', async () => {
    const w = await world();
    const e = { id: 'e9', type: 'calendar-event', title: 'kapper', startsAt: '2026-10-09T12:00:00.000Z', createdBy: 'telegram:1' };
    await w.add(e);
    await w.announcer.around(async () => ({ ok: true }), { caller: 'telegram:1' });   // nothing changed
    expect(w.sent.filter((m) => m.id === 'telegram:2')).toHaveLength(1);
  });
});

describe('the door announces after a writing op — a typed line, the model and a screen alike', async () => {
  const { EventLog } = await import('../src/eventLog.js');
  const { createBotThreads, memoryThreadStore } = await import('../src/v2/botThreads.js');
  const { createAnnouncer } = await import('../src/v2/announcements.js');
  const { withAssistantOps } = await import('../src/v2/assistantOps.js');

  it('addEvent through the door tells the others; a read through the door tells nobody', async () => {
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    let household = { events: [], chores: [] };
    const sent = [];
    const rows = [{ id: 'telegram:1', role: 'member' }, { id: 'telegram:2', role: 'member' }];
    const announcer = createAnnouncer({
      sources: async () => household, users: { list: async () => rows }, threads, t: (k) => k, tz: 'Europe/Amsterdam', quiet: () => '23:00-07:00',
      reach: { sendToPerson: async (id, m) => { sent.push(id); return { ok: true }; } }, log: new EventLog({ initial: [], muted: [] }), now: () => Date.parse('2026-10-07T10:00:00Z'),
    });
    const callSkill = async (app, op) => {
      if (app === 'calendar' && op === 'addEvent') { household = { ...household, events: [{ id: 'e1', type: 'calendar-event', title: 'kapper', startsAt: '2026-10-09T12:00:00.000Z', createdBy: 'telegram:1' }] }; return { ok: true }; }
      return { ok: true, items: [] };
    };
    const door = withAssistantOps({ callSkill, threads, t: (k) => k, announcer });
    await door('calendar', 'listEvents', {}, { caller: 'telegram:1' });
    expect(sent).toEqual([]);
    await door('calendar', 'addEvent', { title: 'kapper' }, { caller: 'telegram:1' });
    expect(sent).toEqual(['telegram:2']);
  });
});
