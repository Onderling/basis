/**
 * The week overview: per person — the appointments of the next seven days, what is on the shopping list, and every open
 * chore with who holds it and its day. It is an op called
 * AS the person (the gate, the role and the names ceiling apply as to anything they type), asked for any time ("wat staat
 * er deze week"), and sent on Sunday at 18:00 to those who switched it on.
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
import { withAssistantOps } from '../src/v2/assistantOps.js';
import { EventLog } from '../src/eventLog.js';
import { createBotThreads, memoryThreadStore } from '../src/v2/botThreads.js';

import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('the week overview', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('the coming appointments, what is on the shopping list, every open chore with who and when — asked as me', async () => {
    expect(BOT_OP_MAP.member).toContain('weekOverview');
    expect(BOT_OP_MAP.observer).toContain('weekOverview');
    dir = await mkdtemp(path.join(tmpdir(), 'bot-overview-'));
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
    for (const [webid, role, displayName] of [['telegram:1', 'member', 'Frits'], ['telegram:2', 'member', 'Bert']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    const tomorrow = local(new Date(Date.now() + 86_400_000));
    await as('telegram:1')('lists', 'addToList', { list: 'Klusjes', text: 'kleurenwiezen', assignee: 'mij', due: tomorrow });
    await as('telegram:2')('lists', 'addToList', { list: 'Klusjes', text: 'bladeren', assignee: 'mij' });
    await own('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen' });                 // nobody holds it
    await own('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    await own('lists', 'addToList', { list: 'Boodschappen', text: 'kaas' });
    await as('telegram:1')('calendar', 'addEvent', { title: 'tandarts', when: `${tomorrow}T10:00` });

    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    await threads.load();
    const door = withAssistantOps({ callSkill: (a, o, x, c) => agent.callSkill(a, o, x, c), threads, t, refusal: agent.doorRefusal, admin: {} });
    const r = await door('assistant', 'weekOverview', {}, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.message).toContain('circle.bot.overview_head');
    expect(r.message).toContain('tandarts');
    // what is on the shopping list, on one line (a household member's ask, 2026-10-05: the items, not a count)
    expect(r.message).toMatch(/overview_list[^\n]*"list":"Boodschappen"[^\n]*"items":"(melk, kaas|kaas, melk)"/);
    // every open chore with who holds it and its day — worded as the names setting lets the asker see
    expect(r.message).toMatch(/overview_list[^\n]*"list":"Klusjes"/);
    expect(r.message).toContain(`circle.lists.chore_held {"text":"kleurenwiezen","who":"circle.lists.chore_you"} (${tomorrow})`);   // the household's clock, not the UTC day
    expect(r.message).toContain('circle.lists.chore_held {"text":"bladeren","who":"Bert"}');
    expect(r.message).toContain('circle.lists.chore_open {"text":"ramen lappen"}');
    expect(r.message).not.toContain('overview_unheld');
  }, 180_000);

  it('"wat staat er deze week" is the overview by the gate — the model does not summarise it itself', async () => {
    const { listsGateRules } = await import('../src/v2/circleGate.js');
    const { templateLists } = await import('../src/v2/householdTemplate.js');
    const rules = listsGateRules('nl', templateLists(t));
    const route = (text) => { for (const r of rules) { const hit = r.test instanceof RegExp ? r.test.test(text) : r.test(text); if (hit) { const c = r.command(text); if (c) return c; } } return null; };
    for (const line of ['wat staat er deze week', 'Wat staat er deze week?', 'wat moet er nog gebeuren', 'wat moet er deze week gebeuren?']) {
      expect(route(line), line).toMatchObject({ opId: 'weekOverview', appOrigin: 'assistant' });
    }
  });

  it('a long list shows its first entries and how many more', async () => {
    const { WEEK_OVERVIEW_MAX_ITEMS } = await import('../src/v2/assistantOps.js');
    const many = Array.from({ length: WEEK_OVERVIEW_MAX_ITEMS + 2 }, (_, i) => ({ id: `s${i}`, label: `ding${i}` }));
    const callSkill = async (app, op, args) => (app === 'lists' && op === 'listEntries' && args.list === 'Boodschappen' ? { ok: true, items: many } : { ok: true, items: [] });
    const threads = createBotThreads({ eventLog: new EventLog({ initial: [], muted: [] }), store: memoryThreadStore() });
    const door = withAssistantOps({ callSkill, threads, t, refusal: async () => null, admin: {} });
    const r = await door('assistant', 'weekOverview', {}, { caller: 'telegram:1', threadId: 'telegram:1' });
    expect(r.message).toContain(`ding${WEEK_OVERVIEW_MAX_ITEMS - 1}`);
    expect(r.message).not.toContain(`ding${WEEK_OVERVIEW_MAX_ITEMS},`);
    expect(r.message).toContain('circle.bot.overview_more {"n":2}');
  });
});
