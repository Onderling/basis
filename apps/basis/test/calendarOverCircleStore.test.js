/**
 * On the household bot, the Agenda holds the household's appointments: the calendar's verbs over the circle's store.
 *
 * The calendar app kept its events in an in-memory pseudo-pod built per agent — no circle, gone at a restart. On a bot
 * install the calendar's verbs work over the circle's ONE store instead: `addEvent` writes a `calendar-event` child of
 * the Agenda list (the calendar's own validation of when and how long), `listEvents` reads a window, an rsvp updates the
 * child, `cancelEvent` removes it. A person's node composes none of it (its calendar is as it was).
 * Two boots over one data dir, the way the box restarts.
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
const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k) => NAMES[k] ?? k;

describe('calendar on the household bot', () => {
  let dir;
  afterAll(async () => { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('an event is an Agenda child in the circle\'s store: listed after a restart, rsvp on the child, cancelled away', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-calendar-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    const boot = (bot = true) => createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      ...(bot ? { ...HOUSEHOLD_BOT_STORE_OPTS } : {}),
    });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const first = await boot();
    const call = (a, o, x) => first.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: call, t });
    const added = await call('calendar', 'addEvent', { title: 'tandarts', when: `${tomorrow}T10:00:00.000Z`, duration: '30m' });
    expect(added.ok, JSON.stringify(added)).toBe(true);
    // the same appointment again (the title, case aside, at the same start): "staat er al", not a second one
    const again = await call('calendar', 'addEvent', { title: 'Tandarts', when: `${tomorrow}T10:00:00.000Z` });
    expect(again.duplicate).toBe(true);
    expect(String(again.message)).toContain('circle.calendar.already_there');
    // a bare add to the Agenda asks for a time instead of making an event with none
    const bare = await call('lists', 'addToList', { list: 'Agenda', text: 'tandarts' });
    expect(bare.ok).toBe(false);
    const agenda = await call('lists', 'listEntries', { list: 'Agenda' });
    expect((agenda.items ?? []).map((i) => i.label), 'the event is an Agenda entry').toContain('tandarts');
    await new Promise((r) => setTimeout(r, 1200));
    await first.stop?.().catch(() => {});

    const second = await boot();
    const call2 = (a, o, x) => second.callSkill(a, o, x);
    const listed = await call2('calendar', 'listEvents', { days: 7 });
    // the coming days say which list they are — the Agenda's own name, as any list read does
    expect(listed.title).toBe('Agenda');
    const ev = (listed.items ?? []).find((i) => /tandarts/.test(i.label));
    expect(ev, `listed after the restart: ${JSON.stringify(listed)}`).toBeTruthy();
    const rsvp = await call2('calendar', 'rsvpAccept', { id: ev.id, actor: 'telegram:111' });
    expect(rsvp.ok, JSON.stringify(rsvp)).toBe(true);
    const child = await call2('calendar', 'getEventSnapshot', { id: ev.id });
    expect(child?.event?.rsvp?.['telegram:111']).toBe('accepted');
    const gone = await call2('calendar', 'cancelEvent', { id: ev.id });
    expect(gone.ok).toBe(true);
    expect(((await call2('calendar', 'listEvents', { days: 7 })).items ?? []).find((i) => i.id === ev.id)).toBeUndefined();
    await second.stop?.().catch(() => {});

    // a person's node composes none of it: its calendar is its own, nothing lands on a circle's Agenda
    const person = await boot(false);
    const own = await person.callSkill('calendar', 'addEvent', { title: 'fysio', when: `${tomorrow}T09:00:00.000Z` });
    expect(own.ok, JSON.stringify(own)).toBe(true);
    const onAgenda = await person.callSkill('lists', 'listEntries', { list: 'Agenda' });
    expect((onAgenda?.items ?? []).map((i) => i.label)).not.toContain('fysio');
    await person.stop?.().catch(() => {});
  }, 180_000);
});
