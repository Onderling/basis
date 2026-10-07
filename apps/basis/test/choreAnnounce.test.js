/**
 * A chore given to someone is told to them — whoever gave it, through the bot or the tasks engine — and never to the
 * one who gave it; a chore someone takes for themselves is told to nobody. Composed as the household bot is (the
 * change feed and the household's announce rows, not the door's own writes).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { bootAnnouncingBox } from './support/announcingBox.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);

describe('a chore given', () => {
  let box;
  afterAll(async () => { await box?.agent?.stop?.().catch(() => {}); if (box?.dir) await rm(box.dir, { recursive: true, force: true }).catch(() => {}); });

  it('taken for oneself: nobody hears; given by the admin to another: they do, and the admin does not', async () => {
    box = await bootAnnouncingBox({ t, tz: 'Europe/Amsterdam', people: [{ id: 'telegram:1', name: 'Ann', role: 'member' }, { id: 'telegram:2', name: 'Bert', role: 'member' }, { id: 'telegram:9', name: 'Frits', role: 'admin' }] });
    const added = await box.door('lists', 'addToList', { list: 'Klusjes', text: 'ramen', assignee: 'mij' }, { caller: 'telegram:1' });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    await box.settled();
    expect(box.sent, 'a chore Ann took for herself is told to nobody').toEqual([]);

    const chore = (await box.agent.reminderSources()).chores.find((c) => c.text === 'ramen');
    const given = await box.door('tasks', 'reassignTask', { id: chore.id, newAssignee: 'telegram:2' }, { caller: 'telegram:9' });
    expect(given.ok !== false, JSON.stringify(given)).toBe(true);
    await box.settled();
    expect(box.sent.map((m) => m.id)).toEqual(['telegram:2']);
    expect(box.sent[0].text).toContain('circle.bot.announce_given');
  }, 90_000);
});
