/**
 * An appointment that names people (Frits 2026-10-06, option A): "tandarts voor Henk" reminds Henk (and its maker),
 * "eten voor iedereen" reminds everyone. The door turns the names into the household's people — as a chore's who is
 * read (`mij` is the asker; a name must be someone the bot knows; "iedereen" names nobody) — so the reminder reads
 * ids, never a word.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { remindedFor } from '../src/v2/botReminders.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:9';
const HENK = 'telegram:1';
const YVONNE = 'telegram:2';

describe('an appointment that names people', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('"voor Henk" names Henk; "voor iedereen" names nobody; an unknown name is said, not stored', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'appt-names-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role, displayName] of [[ADMIN, 'admin', 'Frits'], [HENK, 'member', 'Henk'], [YVONNE, 'member', 'Yvonne']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (who) => (a, o, x) => agent.callSkill(a, o, x, { caller: who });
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const eventNamed = async (title) => (await agent.householdItems()).find((i) => i.type === 'calendar-event' && i.title === title);
    const people = [{ id: ADMIN }, { id: HENK }, { id: YVONNE }];

    const r = await as(YVONNE)('calendar', 'addEvent', { title: 'tandarts', when: `${when}T10:00`, attendees: 'Henk' });
    expect(r.ok, JSON.stringify(r)).not.toBe(false);
    const tandarts = await eventNamed('tandarts');
    expect(tandarts.attendees).toEqual([HENK]);
    expect(remindedFor(tandarts, people).sort()).toEqual([HENK, YVONNE].sort());

    await as(YVONNE)('calendar', 'addEvent', { title: 'eten', when: `${when}T19:45`, attendees: 'iedereen' });
    const eten = await eventNamed('eten');
    expect(eten.attendees ?? []).toEqual([]);
    expect(remindedFor(eten, people).sort()).toEqual([ADMIN, HENK, YVONNE].sort());

    await as(HENK)('calendar', 'addEvent', { title: 'fysio', when: `${when}T09:00`, attendees: 'mij en Yvonne' });
    expect((await eventNamed('fysio')).attendees.sort()).toEqual([HENK, YVONNE].sort());

    const unknown = await as(HENK)('calendar', 'addEvent', { title: 'kapper', when: `${when}T11:00`, attendees: 'Bob' });
    expect(unknown.ok).toBe(false);
    expect(await eventNamed('kapper')).toBeUndefined();
  }, 120_000);
});
