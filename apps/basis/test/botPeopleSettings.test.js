/**
 * The bot's people, after Fable's review of the first chore-with-a-person PR and the disclosure answers:
 * - an observer READS: the host gate refuses them an add or a claim (not only the tools they are shown);
 * - a chore given to someone runs THEIR role's claim rule: an observer cannot be handed a chore;
 * - a bare due date is the household's local day, as an appointment's time is local;
 * - who may see names is the household's ceiling (`assistant.names`: members · assigners · admin · none): a member
 *   under `admin` cannot give a chore by name, and a reply names the assignee only where the asker may see names;
 * - `assignPolicy: bots` — chores go only to the bot contacts (function profiles).
 * One boot composed as the box composes a household bot, the calls carrying the door's person.
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

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const FRITS = 'telegram:111';
const BERT = 'telegram:222';
const OLGA = 'telegram:333';
const ADMIN = 'telegram:999';
const ROBOT = 'bot:vacuum';

describe('the bot\'s people', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('observers read; assignees claim by their own role; due is a local day; names follow the ceiling; bots', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-people-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role, displayName, extra] of [[FRITS, 'member', 'Frits'], [BERT, 'coordinator', 'Bert'], [OLGA, 'observer', 'Olga'], [ADMIN, 'admin', 'Anne'], [ROBOT, 'member', 'Robotstofzuiger', { profileKind: 'function' }]]) {
      await own('stoop', 'addContact', { webid, channel: webid.startsWith('bot:') ? 'web' : 'telegram', role, displayName, ...(extra ?? {}) });
      if (!webid.startsWith('bot:')) await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    const openTasks = async () => ((await own('tasks', 'listOpen', {})).items ?? []);
    const set = (key, value) => own('params', 'set-param', { key, value });

    // an observer reads, and is refused a write at the host gate
    expect((await as(OLGA)('lists', 'listEntries', { list: 'Klusjes' })).ok).toBe(true);
    const olgaAdds = await as(OLGA)('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    expect(olgaAdds.ok).toBe(false);

    // a chore for an observer: their own role cannot claim — refused, nothing made
    const forOlga = await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen', assignee: 'Olga' });
    expect(forOlga.ok).toBe(false);
    expect(String(forOlga.error)).toContain('circle.tasks.assignee_cannot');
    expect((await openTasks()).find((x) => x.text === 'ramen lappen')).toBeUndefined();

    // a bare due date is the local day (not UTC midnight)
    await as(FRITS)('lists', 'addToList', { list: 'Klusjes', text: 'kleurenwiezen', assignee: 'mij', due: '2026-10-05' });
    const due = new Date((await openTasks()).find((x) => x.text === 'kleurenwiezen')?.dueAt);
    expect([due.getFullYear(), due.getMonth() + 1, due.getDate()]).toEqual([2026, 10, 5]);

    // names: under `members` (default) the reply names the assignee
    const named = await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'bladeren', assignee: 'Frits' });
    expect(named.ok, JSON.stringify(named)).toBe(true);
    expect(String(named.message)).toContain('Frits');
    // under `admin` a coordinator cannot give a chore by name; the admin can, and the reply names nobody to others
    await set('assistant.names', 'admin');
    const hidden = await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'gras', assignee: 'Frits' });
    expect(hidden.ok).toBe(false);
    expect(String(hidden.error)).toContain('circle.tasks.names_hidden');
    expect((await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'gras', assignee: 'Frits' })).ok).toBe(true);
    await set('assistant.names', 'members');

    // assignPolicy `bots`: chores go only to the bot contacts
    await set('assistant.assignPolicy', 'bots');
    expect((await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'zuigen', assignee: 'Frits' })).ok).toBe(false);
    const toRobot = await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'zuigen', assignee: 'Robotstofzuiger' });
    expect(toRobot.ok, JSON.stringify(toRobot)).toBe(true);
    await set('assistant.assignPolicy', 'roles');
  }, 180_000);
});
