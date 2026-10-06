/**
 * The layers on the tick (Fable's red-first list): a person's "add" keeps the household's rule and adds theirs;
 * "replace" drops it; a second person sees none of the first's extras; the item's own reminders (the household's
 * statement about it) apply to everyone it is for; the household's list is the base.
 */
import { describe, it, expect } from 'vitest';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { createReminderTick } from '../src/v2/botReminderTick.js';

const TZ = 'Europe/Amsterdam';
const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
const people = [{ id: 'telegram:1', channel: 'telegram', role: 'member' }, { id: 'telegram:2', channel: 'telegram', role: 'member' }];
// Thu 8 Oct 14:00, made the week before: for everyone (it names no one)
const kapper = { id: 'e2', type: 'calendar-event', title: 'kapper', startsAt: '2026-10-08T12:00:00.000Z', createdBy: 'telegram:1', createdAt: '2026-10-01T10:00:00.000Z' };

// the household's morning is left out here: it stays open until the start, and these tests are about the other rules
async function world({ events = [kapper], rules = ['evening-before', 'before:5'] } = {}) {
  const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
  await threads.load();
  let at = 0;
  const sent = [];
  const tick = createReminderTick({
    sources: async () => ({ chores: [], events }), users: { list: async () => people }, threads, t, tz: TZ,
    reach: { sendToPerson: async (id) => { sent.push([new Date(at).toISOString().slice(11, 16), id]); return { ok: true }; } },
    settings: () => ({ reminders: 'on', quiet: '23:00-07:00', rules }), now: () => at,
  });
  const passAt = async (iso) => { at = Date.parse(iso); await tick.pass(); };
  return { threads, sent, passAt };
}

describe('reminder layers on the tick', () => {
  it('"add": the household\'s short notice stays and their hour before comes too — the other person gets only the household\'s', async () => {
    const w = await world();
    w.threads.setReminderDefault('telegram:1', { mode: 'add', rules: ['before:60'] });
    await w.passAt('2026-10-08T11:00:00Z');   // 13:00
    await w.passAt('2026-10-08T11:55:00Z');   // 13:55
    expect(w.sent).toEqual([['11:00', 'telegram:1'], ['11:55', 'telegram:1'], ['11:55', 'telegram:2']]);
  });

  it('"replace": only theirs — no household short notice for them', async () => {
    const w = await world();
    w.threads.setReminderDefault('telegram:1', { mode: 'replace', rules: ['before:60'] });
    await w.passAt('2026-10-08T11:00:00Z');
    await w.passAt('2026-10-08T11:55:00Z');
    expect(w.sent).toEqual([['11:00', 'telegram:1'], ['11:55', 'telegram:2']]);
  });

  it('an extra for one item is that person\'s: the evening before the 14:00 appointment, for them alone', async () => {
    const w = await world();
    w.threads.setReminderExtra('telegram:1', 'e2', { mode: 'add', rules: ['evening-before'] });
    await w.passAt('2026-10-07T17:30:00Z');   // Wed 19:30
    expect(w.sent).toEqual([['17:30', 'telegram:1']]);
  });

  it("the item's own reminders apply to everyone it is for", async () => {
    const w = await world({ events: [{ ...kapper, reminders: { mode: 'add', rules: ['evening-before'] } }] });
    await w.passAt('2026-10-07T17:30:00Z');
    expect(w.sent.map(([, id]) => id).sort()).toEqual(['telegram:1', 'telegram:2']);
  });

  it("the household's list is the base: without a before: rule, no short notice at all", async () => {
    const w = await world({ rules: ['evening-before'] });
    await w.passAt('2026-10-08T11:55:00Z');
    expect(w.sent).toEqual([]);
  });
});
