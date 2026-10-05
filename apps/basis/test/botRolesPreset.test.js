/**
 * What each role may do on a household bot follows ONE per-bot setting, `assistant.roles` (Frits 2026-10-05: "for us,
 * members and coordinators should do what the admin does, except removing the admin"; Fable: two presets now).
 * - standard (the default): a member's column; a coordinator's adds what the tasks role table gives them — moving and
 *   editing a chore (L198: two tables held one fact and disagreed), never removing one; the admin, everything.
 * - flat: members and coordinators get the admin's DATA column (give / move / remove / edit a chore, cancel anyone's
 *   appointment); the door's own admin ops (people, roles, invites, settings, export) stay the admin's; observers read.
 * The gate, the menus (/help, the screen) and the model's tools read the one setting, so they cannot disagree.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows, scopeCatalogueToRole } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { composeAssistantCatalogue } from '../src/telegram/assistantCatalogue.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const FRITS = 'telegram:111';   // member
const BERT = 'telegram:222';    // coordinator
const OLGA = 'telegram:333';    // observer
const ADMIN = 'telegram:999';

describe('the menus follow the preset', () => {
  const { catalogue } = composeAssistantCatalogue({ apps: ['lists', 'tasks', 'calendar'], slim: true });
  const ops = (role, preset) => [...scopeCatalogueToRole(catalogue, role, preset).opsById.values()].map((e) => e.op.id);
  it('standard: a coordinator moves and edits a chore, never removes one; a member neither', () => {
    expect(ops('coordinator', 'standard')).toEqual(expect.arrayContaining(['reassignTask', 'editTask']));
    expect(ops('coordinator', 'standard')).not.toContain('removeTask');
    expect(ops('member', 'standard')).not.toContain('reassignTask');
  });
  it('flat: a member and a coordinator have the admin\'s data column; an observer still reads', () => {
    for (const role of ['member', 'coordinator']) expect(ops(role, 'flat')).toEqual(expect.arrayContaining(['reassignTask', 'editTask', 'removeTask']));
    expect(ops('observer', 'flat')).not.toContain('reassignTask');
    expect(botRoleAllows('observer', 'reassignTask', 'flat')).toBe(false);
  });
});

describe('the gate follows the preset', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('standard, then flat — on the real bot’s gate', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-roles-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role, displayName] of [[FRITS, 'member', 'Frits'], [BERT, 'coordinator', 'Bert'], [OLGA, 'observer', 'Olga'], [ADMIN, 'admin', 'Anne']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    const chore = async (text) => {
      await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text });
      return ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === text)?.id;
    };

    // standard: the coordinator gives an existing chore to someone (L198); the member cannot; removing is the admin's
    const ramen = await chore('ramen');
    const moved = await as(BERT)('tasks', 'reassignTask', { id: ramen, newAssignee: FRITS });
    expect(moved.ok, JSON.stringify(moved)).not.toBe(false);
    expect((await as(FRITS)('tasks', 'reassignTask', { id: ramen, newAssignee: BERT })).ok).toBe(false);
    expect((await as(BERT)('tasks', 'removeTask', { id: ramen })).ok).toBe(false);

    // flat: the member does the admin's data work — moves, removes a chore, cancels someone else's appointment
    await own('params', 'set-param', { key: 'assistant.roles', value: 'flat' });
    const stof = await chore('stofzuigen');
    expect((await as(FRITS)('tasks', 'reassignTask', { id: stof, newAssignee: BERT })).ok).not.toBe(false);
    expect((await as(FRITS)('tasks', 'removeTask', { id: stof })).ok).not.toBe(false);
    const ev = await as(ADMIN)('calendar', 'addEvent', { title: 'tandarts', when: new Date(Date.now() + 86_400_000).toISOString() });
    const evId = ev?.itemId ?? ev?.id ?? ((await own('calendar', 'listEvents', { days: 7 })).items ?? [])[0]?.id;
    expect((await as(FRITS)('calendar', 'cancelEvent', { id: evId })).ok, 'a member cancels the admin’s appointment under flat').not.toBe(false);
    // ...and an observer still only reads
    const glas = await chore('glas');
    expect((await as(OLGA)('tasks', 'reassignTask', { id: glas, newAssignee: FRITS })).ok).toBe(false);
  }, 60_000);
});

describe('the preset is a household setting', () => {
  it('/huishouden roles flat: saved, on the menu, the Telegram menus told, and the screens hint', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const { createBotThreads, memoryThreadStore } = await import('../src/v2/botThreads.js');
    const { EventLog } = await import('../src/eventLog.js');
    const params = new Map();
    const changed = [];
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const door = withAssistantOps({
      callSkill: async (app, op, args) => {
        if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...params].map(([key, value]) => ({ key, value })) };
        if (app === 'params' && op === 'set-param') { params.set(args.key, args.value); return { ok: true }; }
        return { ok: true };
      },
      threads, t: (k, p) => (p ? `${k} ${JSON.stringify(p)}` : k), refusal: async () => null,
      admin: { users: async () => [{ id: ADMIN, channel: 'telegram', uid: '999', role: 'admin' }], onSettingChanged: (key) => changed.push(key) },
    });
    const r = await door('assistant', 'assistant-settings', { change: 'roles flat' }, { caller: ADMIN, threadId: ADMIN, chatId: '999' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(params.get('assistant.roles')).toBe('flat');
    expect(changed).toEqual(['assistant.roles']);
    expect(r.message).toContain('circle.bot.roles_changed');
    expect(r.quickReplies.map((q) => q.label)).toContain('circle.bot.menu_roles: circle.bot.value_flat ✓');
    expect((await door('assistant', 'assistant-settings', { change: 'roles everyone' }, { caller: ADMIN, threadId: ADMIN })).ok).toBe(false);
  });
});
