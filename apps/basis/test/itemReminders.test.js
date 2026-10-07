/**
 * An item's own reminders — the household's statement about it, synced like its words: said when it is made
 * ("tandarts donderdag 9 uur, ook de avond ervoor") or changed later (`entryReminders`, whoever may edit the entry),
 * in the same words a person uses for their own. Words it does not know set nothing. Composed as the household bot is.
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
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);

describe("an item's own reminders", () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('set at addEvent, changed by entryReminders, dropped by "gewoon", refused when not understood', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'item-reminders-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false, ...HOUSEHOLD_BOT_STORE_OPTS, t,
    });
    const call = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: call, t });
    const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const made = await call('calendar', 'addEvent', { title: 'tandarts', when: `${day}T09:00`, reminders: 'ook avond' });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const event = async () => (await agent.reminderSources()).events.find((e) => e.title === 'tandarts');
    expect((await event())?.reminders).toEqual({ mode: 'add', rules: ['evening-before'] });

    const edited = await call('lists', 'entryReminders', { item: 'tandarts', reminders: '60' });
    expect(edited.ok, JSON.stringify(edited)).toBe(true);
    expect((await event()).reminders).toEqual({ mode: 'replace', rules: ['before:60'] });
    expect((await event()).title, 'its words stay').toBe('tandarts');
    await call('lists', 'entryReminders', { item: 'tandarts', reminders: 'gewoon' });
    expect((await event()).reminders, '"gewoon": the usual ones again').toBeUndefined();

    const refused = await call('calendar', 'addEvent', { title: 'kapper', when: `${day}T14:00`, reminders: 'straks misschien' });
    expect(refused.ok).toBe(false);
  }, 90_000);
});
