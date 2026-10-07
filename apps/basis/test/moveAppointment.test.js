/**
 * J4 — the tandarts moves. An appointment is a line; its edit takes a new time as it takes new words
 * (`editEntry({ item, when })`, gated as any edit of the line). Moved, it keeps its length; the household hears ONE
 * "verplaatst" — not "gaat niet door" + "nieuw" — and its reminders follow it (Thursday's gone, Friday's there).
 * Composed as the household bot is: the store's write hook feeds the change feed, whose change fires the household's
 * announce row, which the runner hands to the door as the host.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { bootAnnouncingBox } from './support/announcingBox.js';
import { reminderOccurrences, householdRules } from '../src/v2/reminderOccurrences.js';
import { screenActionForm } from '../src/v2/screenPaint.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const TZ = 'Europe/Amsterdam';

describe('moving an appointment', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('editEntry with `when` moves it (its length kept): one "moved" to the others, and its reminders follow', async () => {
    const box = await bootAnnouncingBox({ t, tz: TZ, people: [{ id: 'telegram:1', name: 'Ann', role: 'member' }, { id: 'telegram:2', name: 'Bert', role: 'member' }] });
    ({ dir, agent } = box);
    const { door, sent, settled } = box;
    expect(box.seeded).toBe(2);
    const people = [{ id: 'telegram:1' }, { id: 'telegram:2' }];
    const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const added = await door('calendar', 'addEvent', { title: 'tandarts', when: `${day(3)}T14:00`, duration: '30m' }, { caller: 'telegram:1' });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    await settled();
    expect(sent.map((m) => m.id), 'the new appointment: told to the other, not its maker').toEqual(['telegram:2']);
    sent.length = 0;

    const moved = await door('lists', 'editEntry', { item: 'tandarts', when: `${day(4)}T14:00` }, { caller: 'telegram:1' });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    await settled();
    const e = (await agent.reminderSources()).events.find((x) => x.title === 'tandarts');
    expect(e.startsAt.slice(0, 10)).toBe(day(4));
    expect(new Date(e.endsAt) - new Date(e.startsAt), 'its length is kept').toBe(30 * 60_000);
    expect(sent.map((m) => m.id)).toEqual(['telegram:2']);
    expect(sent[0].text).toContain('circle.bot.announce_moved');
    expect(sent[0].text).not.toContain('announce_new');
    expect(sent[0].text).not.toContain('announce_cancelled');
    // its reminders follow it: the household's morning is on the new day
    const morning = reminderOccurrences({ events: [e], people, now: Date.now(), tz: TZ, rulesFor: () => householdRules(5), horizon: 10 * 86_400_000 })
      .filter((o) => o.rule === 'morning');
    expect(morning.every((o) => o.id.includes(`:morning:${day(4)}:`))).toBe(true);
  }, 90_000);

  it('a bare day keeps its time of day: "zet de tandarts op vrijdag" → Friday at the same hour, one "verplaatst"', async () => {
    const own = (a, o, x) => agent.callSkill(a, o, x);
    const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    expect((await own('calendar', 'addEvent', { title: 'kapper', when: `${day(3)}T14:00` })).ok).toBe(true);
    const before = (await agent.reminderSources()).events.find((x) => x.title === 'kapper');
    const moved = await own('lists', 'editEntry', { item: 'kapper', when: day(5) });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    const after = (await agent.reminderSources()).events.find((x) => x.title === 'kapper');
    const hm = (iso) => { const d = new Date(iso); return `${d.getHours()}:${d.getMinutes()}`; };
    expect(after.startsAt.slice(0, 10)).toBe(day(5));
    expect(hm(after.startsAt), 'the hour stays').toBe(hm(before.startsAt));
    expect(new Date(after.endsAt) - new Date(after.startsAt)).toBe(new Date(before.endsAt) - new Date(before.startsAt));
  }, 60_000);

  it('the screen\'s edit form still asks for the words (and offers the time)', () => {
    expect(screenActionForm('lists.editEntry', { item: 'e1', list: 'Boodschappen' })?.missing).toContain('text');
  });
});
