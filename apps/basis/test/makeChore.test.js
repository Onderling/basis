/**
 * A line on a list becomes a chore when someone says who does it or when (Fable on the item/task spectrum, 2026-10-05):
 * list-item and task stay two types — their verbs differ — and ONE declared verb, `makeChore` on the lists manifest,
 * turns a line into a task in place: the same id, the same list, holders and due as given. The add calls it when a who
 * or a when is said; a person calls it on a line that is already there.
 *
 * Before this, "melk voor Bob" on Boodschappen dropped Bob without a word: the add only gave a person to a line that
 * was a chore already.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows, BOT_OP_MAP } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:9';
const BOB = 'telegram:2';

describe('a line becomes a chore', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('"melk voor Bob" on Boodschappen is a chore of Bob\'s on Boodschappen; a line already there becomes one, same id', async () => {
    expect(BOT_OP_MAP.member).toContain('lists.makeChore');
    dir = await mkdtemp(path.join(tmpdir(), 'make-chore-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role, displayName] of [[ADMIN, 'admin', 'Anne'], [BOB, 'member', 'Bob']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (who) => (a, o, x) => agent.callSkill(a, o, x, { caller: who });
    const find = async (text) => (await agent.householdItems()).find((i) => i.text === text);
    const holders = (i) => [...(i?.assignees ?? []), i?.assignee].filter(Boolean);

    // the add with a who
    const r = await as(ADMIN)('lists', 'addToList', { list: 'Boodschappen', text: 'melk', assignee: 'Bob' });
    expect(r.ok, JSON.stringify(r)).not.toBe(false);
    const melk = await find('melk');
    expect(melk.type).toBe('task');
    expect(holders(melk)).toContain(BOB);
    const boodschappen = ((await own('lists', 'listLists', {})).items ?? []).find((l) => (l.label ?? l.text) === 'Boodschappen');
    expect(melk.containedBy).toContain(boodschappen.id);   // still on Boodschappen
    expect(((await as(BOB)('tasks', 'listMine', {})).items ?? []).map((x) => x.text)).toContain('melk');

    // the add with a when, no who
    await as(ADMIN)('lists', 'addToList', { list: 'Boodschappen', text: 'taart', due: '2026-12-24' });
    const taart = await find('taart');
    expect(taart.type).toBe('task');
    expect(taart.dueAt).toBeTruthy();

    // a line that is already there: the person makes it a chore — the same id
    await as(ADMIN)('lists', 'addToList', { list: 'Boodschappen', text: 'kaas' });
    const kaas = await find('kaas');
    expect(kaas.type).toBe('list-item');
    const made = await as(BOB)('lists', 'makeChore', { item: 'kaas', assignee: 'mij' });
    expect(made.ok, JSON.stringify(made)).not.toBe(false);
    const after = await find('kaas');
    expect(after.id).toBe(kaas.id);
    expect(after.type).toBe('task');
    expect(holders(after)).toContain(BOB);
    expect(after.containedBy).toEqual(kaas.containedBy);
    // ...and it is a chore from then on: done is the chore's own completion
    expect((await as(BOB)('lists', 'markListItemDone', { item: 'kaas' })).ok).not.toBe(false);
    expect(((await own('tasks', 'listOpen', {})).items ?? []).map((x) => x.text)).not.toContain('kaas');
  }, 120_000);
});
