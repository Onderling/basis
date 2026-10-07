/**
 * J4 — the tandarts moves. An appointment is a line; its edit takes a new time as it takes new words
 * (`editEntry({ item, when })`, gated as any edit of the line). Moved, it keeps its length; the household hears ONE
 * "verplaatst" — not "gaat niet door" + "nieuw" — and its reminders follow it (Thursday's gone, Friday's there).
 * Composed as the household bot is.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { createAnnouncer } from '../src/v2/announcements.js';
import { reminderOccurrences, householdRules } from '../src/v2/reminderOccurrences.js';
import { screenActionForm } from '../src/v2/screenPaint.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const TZ = 'Europe/Amsterdam';

describe('moving an appointment', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('editEntry with `when` moves it (its length kept): one "moved" to the others, and its reminders follow', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'move-appointment-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false, ...HOUSEHOLD_BOT_STORE_OPTS, t,
    });
    // the agent as the box's own key; the door's context still says who did it (the announcer reads that)
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const sent = [];
    const people = [{ id: 'telegram:1', role: 'member' }, { id: 'telegram:2', role: 'member' }];
    const announcer = createAnnouncer({
      sources: () => agent.reminderSources(), users: { list: async () => people }, threads, t, tz: TZ, quiet: () => null,
      reach: { sendToPerson: async (id, m) => { sent.push({ id, text: m.text }); return { ok: true }; } }, log: new EventLog({ initial: [], muted: [] }),
    });
    const door = withAssistantOps({ callSkill: own, threads, t, announcer });
    const day = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    expect((await door('calendar', 'addEvent', { title: 'tandarts', when: `${day(3)}T14:00`, duration: '30m' }, { caller: 'telegram:1' })).ok).toBe(true);
    sent.length = 0;

    const moved = await door('lists', 'editEntry', { item: 'tandarts', when: `${day(4)}T14:00` }, { caller: 'telegram:1' });
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
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

  it('the screen\'s edit form still asks for the words (and offers the time)', () => {
    expect(screenActionForm('lists.editEntry', { item: 'e1', list: 'Boodschappen' })?.missing).toContain('text');
  });
});
