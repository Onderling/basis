/**
 * A chore can say who and when (Frits' session, 2026-09-30): "nieuwe taak voor mij: kleurenwiezen (maandag)" and
 * "… voor Bert (dinsdag)". On a list whose entries are chores, an add takes an `assignee` (me, or a name the bot knows)
 * and a `due` date; the chore is made claimed by that person, due that day. WHO may be named is the bot's setting,
 * set by its admin (`assistant.assignPolicy`) and enforced at the waist — default `self`: a member names only
 * themselves, the admin anyone. The gate's typed "nieuwe taak: X" rule leaves a sentence with a person or a day to the
 * model. One boot, composed as the box composes a household bot, the calls carrying the door's person.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists, templateLists } from '../src/v2/householdTemplate.js';
import { botOpLevel } from '../src/v2/botOpMap.js';
import { listsGateRules } from '../src/v2/circleGate.js';

import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const FRITS = 'telegram:111';
const BERT = 'telegram:222';
const ADMIN = 'telegram:999';

describe('a chore that says who and when', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('for me / for Bert, due a day; a member may name only themselves; an unknown name says who is known', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-chore-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass),
      chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') },
      seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    // the bot's people: contact rows, as its door admits them (the admin's role is the door's)
    for (const [webid, role, displayName] of [[FRITS, 'member', 'Frits'], [BERT, 'member', 'Bert'], [ADMIN, 'admin', 'Anne']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    const openTasks = async () => ((await own('tasks', 'listOpen', {})).items ?? []);

    // "nieuwe taak voor mij: kleurenwiezen (maandag)" — claimed by the caller, due Monday
    const mine = await as(FRITS)('lists', 'addToList', { list: 'Klusjes', text: 'kleurenwiezen', assignee: 'mij', due: '2026-10-05' });
    expect(mine.ok, JSON.stringify(mine)).toBe(true);
    const made = (await openTasks()).find((x) => x.text === 'kleurenwiezen');
    expect(made?.assignees ?? [made?.assignee]).toContain(FRITS);
    expect(String(made?.dueAt ?? '')).toMatch(/^2026-10-0[45]/);

    // a member naming someone else, under the default policy: refused, nothing made
    const other = await as(FRITS)('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen', assignee: 'Bert' });
    expect(other.ok).toBe(false);
    expect(String(other.error)).toContain('circle.tasks.assign_refused');
    expect((await openTasks()).find((x) => x.text === 'ramen lappen')).toBeUndefined();

    // the admin may name anyone: "voor Bert (dinsdag)"
    const forBert = await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'kleurenwiezen boven', assignee: 'bert', due: '2026-10-06' });
    expect(forBert.ok, JSON.stringify(forBert)).toBe(true);
    const bertsChore = (await openTasks()).find((x) => x.text === 'kleurenwiezen boven');
    expect(bertsChore?.assignees ?? [bertsChore?.assignee]).toContain(BERT);

    // the admin's setting "anyone": now a member may name Bert too
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'anyone' });
    const byMember = await as(FRITS)('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen', assignee: 'Bert' });
    expect(byMember.ok, JSON.stringify(byMember)).toBe(true);
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'roles' });

    // a coordinator (the same role word as a circle's roster) may give chores to others — the tasks app's rule
    await own('stoop', 'addContact', { webid: BERT, channel: 'telegram', role: 'coordinator', displayName: 'Bert' });
    const byCoordinator = await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'bladeren harken', assignee: 'Frits' });
    expect(byCoordinator.ok, JSON.stringify(byCoordinator)).toBe(true);
    // …unless the household's setting says nobody gives chores to others
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'self' });
    const tightened = await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'gras maaien', assignee: 'Frits' });
    expect(String(tightened.error)).toContain('circle.tasks.assign_refused');
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'roles' });

    // a name the bot does not know: said — and who IS known is not (whether names are shared is the household's choice)
    const who = await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'stofzuigen', assignee: 'Karel' });
    expect(who.ok).toBe(false);
    expect(String(who.error)).toContain('circle.tasks.no_such_person');
    expect(String(who.error)).not.toContain('Bert');
  }, 180_000);

  it('the gate\'s typed rule takes "nieuwe taak: X" only; a person or a day goes to the model', () => {
    const rules = listsGateRules('nl', templateLists(t));
    const rule = rules.find((r) => r.name === 'lists:addToList(task-on-chores)');
    const hits = (s) => (rule.test.test ? rule.test.test(s) : rule.test(s));
    expect(hits('nieuwe taak: kleurenwiezen')).toBe(true);
    expect(hits('nieuwe taak voor mij: kleurenwiezen')).toBe(false);
    expect(hits('nieuwe taak: kleurenwiezen maandag')).toBe(false);
    expect(hits('add task call the plumber tomorrow')).toBe(false);
    expect(hits('add task call the plumber')).toBe(true);
  });

  it('the admin sets it with /huishouden; anything else is the usage line', async () => {
    const { withAssistantOps } = await import('../src/v2/assistantOps.js');
    const stored = new Map();
    const inner = async (app, op, args) => {
      if (app === 'params' && op === 'set-param') { stored.set(args.key, args.value); return { ok: true }; }
      if (app === 'params' && op === 'list-user-params') return { ok: true, params: [...stored].map(([key, value]) => ({ key, value })) };
      return { ok: false };
    };
    const call = withAssistantOps({ callSkill: inner, threads: null, t, admin: {} });
    const shown = await call('assistant', 'assistant-settings', {});
    expect(shown.message).toContain('"assign":"roles"');
    expect(shown.message).toContain('"names":"members"');
    expect((await call('assistant', 'assistant-settings', { change: 'names none' })).message).toContain('"names":"none"');
    expect((await call('assistant', 'assistant-settings', { change: 'passed keep' })).message).toContain('"passed":"keep"');
    expect((await call('assistant', 'assistant-settings', { change: 'days 3' })).message).toContain('"days":3');
    expect((await call('assistant', 'assistant-settings', { change: 'days soon' })).ok).toBe(false);
    expect((await call('assistant', 'assistant-settings', { change: 'cancel admin' })).message).toContain('"cancel":"admin"');
    const set = await call('assistant', 'assistant-settings', { change: 'assign anyone' });
    expect(set.message).toContain('"assign":"anyone"');
    expect((await call('assistant', 'assistant-settings', { change: 'assign everybody' })).ok).toBe(false);
    // /role <naam> coordinator|member|observer — the admin gives a role; never admin, never an unknown word
    const given = [];
    const withRole = withAssistantOps({ callSkill: inner, threads: null, t, admin: { setRole: async (who, role) => { given.push([who, role]); return { displayName: who, role }; } } });
    expect((await withRole('assistant', 'assistant-role', { spec: 'Bert coordinator' })).message).toContain('circle.bot.role_set');
    expect(given).toEqual([['Bert', 'coordinator']]);
    expect((await withRole('assistant', 'assistant-role', { spec: 'Bert admin' })).ok).toBe(false);
  });

  it('a person with no name is named by the id the bot shows for them (/users)', async () => {
    const own = (a, o, x) => agent.callSkill(a, o, x);
    const NONAME = 'web-person-without-a-name-1234567890abcdef';
    await own('stoop', 'addContact', { webid: NONAME, channel: 'web', role: 'member' });
    await agent.setDoorCaller(NONAME, 'member');
    const r = await agent.callSkill('lists', 'addToList', { list: 'Klusjes', text: 'afwas', assignee: NONAME, due: '2026-10-07' }, { caller: ADMIN });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const made = (((await own('tasks', 'listOpen', {})).items) ?? []).find((x) => x.text === 'afwas');
    expect(made?.assignees ?? [made?.assignee]).toContain(NONAME);
  });
});
