/**
 * The household becomes a circle with an id of its own. A circle id is the scope key on every device, so two households
 * both called `household` would MERGE on the phone of a person who is in both: the id is the bot's, derived from its
 * key (`household:<16 hex>`), the same after a restore. The box's existing household moves ONCE, on the first boot of
 * this version: the rows under `household` are renamed to the derived id (item ids unchanged), and never again.
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
import { HOUSEHOLD_BOT_STORE_OPTS, householdCircleIdFor } from '../src/v2/householdBotStore.js';
import { exportFromHost, importHousehold } from '../src/v2/householdExport.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const ADMIN = 'telegram:9';

/** The store opts before this version: the household's rows under the bare `household` id. */
const BEFORE = Object.freeze({ ...HOUSEHOLD_BOT_STORE_OPTS, tasksCircleId: 'household' });

const dirs = [];
const agents = [];
afterAll(async () => {
  for (const a of agents) await a?.stop?.().catch(() => {});
  for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
});

async function boxDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'household-circle-'));
  dirs.push(dir);
  await writeFile(path.join(dir, 'vault.passphrase'), randomBytes(32).toString('base64url'), { mode: 0o600 });
  return dir;
}
async function boot(dir, storeOpts) {
  const { readFile } = await import('node:fs/promises');
  const pass = await readFile(path.join(dir, 'vault.passphrase'), 'utf8');
  const agent = await createRealHouseholdAgent({
    ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
    chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
    householdPersistDb: { path: path.join(dir, 'household-items.json') },
    seedDemoData: false, seedHousehold: false,
    ...storeOpts, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
  });
  agents.push(agent);
  return agent;
}
/** The store saves on a timer: wait until its file has stopped changing, as a box's restart comes after its last save. */
async function saved(dir) {
  const { stat } = await import('node:fs/promises');
  let last = null; let same = 0;
  for (let i = 0; i < 100 && same < 4; i += 1) {
    const now = await stat(path.join(dir, 'household-items.json')).then((s) => `${s.size}:${s.mtimeMs}`).catch(() => null);
    same = now && now === last ? same + 1 : 0;
    last = now;
    await new Promise((r) => setTimeout(r, 250));
  }
}
const listNames = async (agent) => ((await agent.callSkill('lists', 'listLists', {})).items ?? []).map((l) => l.label ?? l.text).sort();

describe('the household circle id', () => {
  it('is derived from the bot\'s key: the same key the same id, two bots two ids', () => {
    const a = householdCircleIdFor('A'.repeat(43));
    expect(a).toMatch(/^household:[0-9a-f]{16}$/);
    expect(householdCircleIdFor('A'.repeat(43))).toBe(a);
    expect(householdCircleIdFor('B'.repeat(43))).not.toBe(a);
    expect(() => householdCircleIdFor('')).toThrow();
  });
});

describe('the box\'s household moves to its circle id once', () => {
  it('a box with data under `household` boots the new version: the same lists and chores, under the derived id; a second boot moves nothing', async () => {
    const dir = await boxDir();
    const old = await boot(dir, BEFORE);
    await ensureHouseholdLists({ callSkill: (a, o, x) => old.callSkill(a, o, x), t });
    await old.callSkill('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    await old.callSkill('stoop', 'addContact', { webid: ADMIN, channel: 'telegram', role: 'admin', displayName: 'Anne' });
    await old.setDoorCaller(ADMIN, 'admin');
    await old.callSkill('lists', 'addToList', { list: 'Klusjes', text: 'ramen', assignee: 'mij' }, { caller: ADMIN });
    await old.callSkill('lists', 'addToList', { list: 'Klusjes', text: 'stoffen', assignee: 'mij' }, { caller: ADMIN });
    const before = await listNames(old);
    const itemsBefore = (await old.householdItems()).map((i) => i.id).sort();
    expect(itemsBefore.length).toBeGreaterThan(4);
    await old.stop?.().catch(() => {});
    await saved(dir);

    const moved = await boot(dir, HOUSEHOLD_BOT_STORE_OPTS);
    expect(moved.householdCircleId).toMatch(/^household:[0-9a-f]{16}$/);
    expect(moved.householdCircleMove).toMatchObject({ from: 'household', to: moved.householdCircleId });
    expect(moved.householdCircleMove.rows).toBeGreaterThan(4);
    expect(await listNames(moved)).toEqual(before);
    expect((await moved.householdItems()).map((i) => i.id).sort()).toEqual(itemsBefore);   // item ids unchanged
    const entries = await moved.callSkill('lists', 'listEntries', { list: 'Boodschappen' });
    expect(entries.items.map((i) => i.label)).toContain('melk');
    // a chore keeps who holds it, and its holder can still finish it
    const ramen = ((await moved.callSkill('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === 'ramen');
    expect([...(ramen?.assignees ?? []), ramen?.assignee]).toContain(ADMIN);
    await moved.setDoorCaller(ADMIN, 'admin');
    const done = await moved.callSkill('tasks', 'completeTask', { id: ramen.id }, { caller: ADMIN });
    expect(done.ok, JSON.stringify(done)).not.toBe(false);
    expect(((await moved.callSkill('tasks', 'listOpen', {})).items ?? []).map((x) => x.text)).toEqual(expect.arrayContaining(['stoffen']));
    expect(((await moved.callSkill('tasks', 'listOpen', {})).items ?? []).map((x) => x.text)).not.toContain('ramen');
    // a new line lands under the derived id too, not back under `household`
    await moved.callSkill('lists', 'addToList', { list: 'Boodschappen', text: 'kaas' });
    const ids = (await moved.householdItems()).length;
    await moved.stop?.().catch(() => {});
    await saved(dir);

    const again = await boot(dir, HOUSEHOLD_BOT_STORE_OPTS);
    expect(again.householdCircleMove).toBeNull();
    expect((await again.householdItems()).length).toBe(ids);
    expect((await again.callSkill('lists', 'listEntries', { list: 'Boodschappen' })).items.map((i) => i.label)).toEqual(expect.arrayContaining(['melk', 'kaas']));
  }, 120_000);

  it('a restore from an export made before the move lands under the derived id', async () => {
    const old = await boot(await boxDir(), BEFORE);
    await ensureHouseholdLists({ callSkill: (a, o, x) => old.callSkill(a, o, x), t });
    await old.callSkill('lists', 'addToList', { list: 'Boodschappen', text: 'appels' });
    const file = await exportFromHost({ items: old.householdItems, people: async () => [], params: async () => [] });

    const fresh = await boot(await boxDir(), HOUSEHOLD_BOT_STORE_OPTS);
    expect(fresh.householdCircleMove).toBeNull();   // nothing to move on a new box
    const r = await importHousehold(file, { call: (a, o, x, c) => fresh.callSkill(a, o, x, c) });
    expect(r.ok, JSON.stringify(r)).not.toBe(false);
    expect((await fresh.householdItems()).map((i) => i.text)).toContain('appels');
    expect((await fresh.callSkill('lists', 'listEntries', { list: 'Boodschappen' })).items.map((i) => i.label)).toContain('appels');
  }, 120_000);
});
