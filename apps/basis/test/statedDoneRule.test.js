/**
 * "ramen is klaar" is mostly a reply to the bot's own reminder, so it must work every time, also without a model
 * (Fable, 2026-10-01). One gate rule, no type choice in it: `markListItemDone(item: the words)`. The waist resolves the
 * words to one item; on a chore it hands over to the chore's own verb (`completeTask`), as the person — so the role
 * rule applies as it does today. Two that match still get "which one?".
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

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const run = (rules, text) => { for (const r of rules) { const ok = typeof r.test === 'function' ? r.test(text) : r.test.test(text); if (ok) { const c = r.command(text, {}); if (c) return c; } } return null; };

describe('the stated-done rule', () => {
  it('takes "X is klaar / gedaan / gekocht / gemaakt / af" and the English, and leaves other sentences alone', () => {
    const nl = listsGateRules('nl', templateLists(t));
    expect(run(nl, 'ramen is klaar')).toMatchObject({ opId: 'markListItemDone', args: { item: 'ramen' } });
    expect(run(nl, 'De melk is gekocht!')).toMatchObject({ opId: 'markListItemDone', args: { item: 'melk' } });
    expect(run(nl, 'de lamp is gemaakt')).toMatchObject({ opId: 'markListItemDone', args: { item: 'lamp' } });
    expect(run(nl, 'de afwas is af')).toMatchObject({ opId: 'markListItemDone', args: { item: 'afwas' } });
    expect(run(listsGateRules('en', templateLists(t)), 'the milk is bought')).toMatchObject({ opId: 'markListItemDone', args: { item: 'milk' } });
    expect(run(nl, 'is het eten klaar?')).toBeNull();
    expect(run(nl, 'wanneer is de lamp klaar')).toBeNull();
  });
});

describe('ticking a chore off by its words', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('a chore is completed through its own op, as the person; two matches ask; someone else\'s goes through the role rule', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-done-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      tasksCircleId: 'household', calendarInCircle: true, doorOpLevel: botOpLevel, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role] of [['telegram:1', 'member'], ['telegram:2', 'member']]) { await own('stoop', 'addContact', { webid, channel: 'telegram', role }); await agent.setDoorCaller(webid, role); }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    expect((await as('telegram:1')('lists', 'addToList', { list: 'Klusjes', text: 'ramen', assignee: 'mij' })).ok).toBe(true);
    const done = await as('telegram:1')('lists', 'markListItemDone', { item: 'ramen' });
    expect(done.ok, JSON.stringify(done)).toBe(true);
    // the chore's own verb did it: its reply, not a list entry's
    expect(String(done.message)).toContain('circle.tasks.reply.completed');
    const open = (((await own('tasks', 'listOpen', {})).items) ?? []).map((x) => x.text);
    expect(open).not.toContain('ramen');
    const chore = (await agent.householdItems()).find((i) => i.type === 'task' && i.text === 'ramen');
    expect(chore?.status === 'completed' || chore?.state === 'completed' || Boolean(chore?.completedAt), JSON.stringify(chore)).toBe(true);
    // someone else's chore, by its words: the chore's own rule decides (as completeTask does today), not a plain tick
    expect((await as('telegram:2')('lists', 'addToList', { list: 'Klusjes', text: 'vuilnis', assignee: 'mij' })).ok).toBe(true);
    expect((await as('telegram:2')('lists', 'addToList', { list: 'Klusjes', text: 'glasbak', assignee: 'mij' })).ok).toBe(true);
    const direct = await as('telegram:1')('tasks', 'completeTask', { id: 'vuilnis' });
    const byWords = await as('telegram:1')('lists', 'markListItemDone', { item: 'glasbak' });
    expect(byWords.ok, JSON.stringify({ direct, byWords })).toBe(direct.ok);
    // only "melk en kaas" open: "kaas" is a part of it — asked, not ticked
    await own('lists', 'addToList', { list: 'Boodschappen', text: 'melk en kaas' });
    const part = await as('telegram:1')('lists', 'markListItemDone', { item: 'kaas' });
    const stillOpen = (await agent.householdItems()).find((i) => i.text === 'melk en kaas');
    expect(stillOpen?.completedAt ?? null, JSON.stringify(part)).toBeNull();
  }, 120_000);
});
