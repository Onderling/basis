/**
 * A report about the past is a tick, not an rsvp (Frits: ticking is always possible): "ik ben bij de tandarts geweest"
 * ticks the appointment like any entry; the coming days no longer show it. What happens to a done chore, a ticked entry
 * and a passed appointment is ONE household setting (`assistant.passedItems`): keep (shown, marked) · hide (shown,
 * marked, for `assistant.passedKeepDays` days — by default 0: a ticked "melk" leaves the next read) · delete. One boot composed as the box composes a bot.
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
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('what is done or has passed', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('an appointment is ticked like an entry; done and passed things follow the household\'s setting', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-passed-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, t,
    });
    const call = (a, o, x) => agent.callSkill(a, o, x);
    const set = (key, value) => call('params', 'set-param', { key, value });
    const labels = async (list) => ((await call('lists', 'listEntries', { list })).items ?? []).map((i) => i.label);
    await ensureHouseholdLists({ callSkill: call, t });

    // "ik ben bij de tandarts geweest": a tick of the appointment — the coming days no longer show it
    await call('calendar', 'addEvent', { title: 'tandarts', when: `${local(new Date(Date.now() + 86_400_000))}T10:00` });
    expect((await call('lists', 'markListItemDone', { item: 'tandarts' })).ok).toBe(true);
    expect(((await call('calendar', 'listEvents', { days: 7 })).items ?? []).length).toBe(0);
    // the default keeps nothing on a read: the ticked appointment leaves it at once (it stays in the store)
    expect((await labels('Agenda')).join('|')).not.toContain('tandarts');
    // hide for 7 days (the admin's choice): shown, marked
    await set('assistant.passedKeepDays', 7);
    expect((await labels('Agenda')).join('|')).toContain('circle.lists.entry_done');

    // a passed appointment (yesterday) is shown marked as passed, not as an open one
    await call('calendar', 'addEvent', { title: 'huisarts', when: `${local(new Date(Date.now() - 86_400_000))}T10:00` });
    expect((await labels('Agenda')).join('|')).toContain('circle.lists.event_passed');

    // a ticked entry under hide: shown marked; after the days are up (0 here): gone from the read
    await call('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    await call('lists', 'markListItemDone', { item: 'melk' });
    expect((await labels('Boodschappen')).join('|')).toContain('circle.lists.entry_done');
    await set('assistant.passedKeepDays', 0);
    expect(await labels('Boodschappen')).toEqual([]);

    // keep: shown however old
    await set('assistant.passedItems', 'keep');
    expect((await labels('Boodschappen')).join('|')).toContain('circle.lists.entry_done');

    // delete: gone from the store itself
    await set('assistant.passedItems', 'delete');
    expect(await labels('Boodschappen')).toEqual([]);
    const all = await call('lists', 'listEntries', { list: 'Boodschappen' });
    expect(all.items ?? []).toEqual([]);
    await set('assistant.passedItems', 'keep');
    expect(await labels('Boodschappen')).toEqual([]);   // deleted is deleted: keep brings nothing back
  }, 180_000);
});
