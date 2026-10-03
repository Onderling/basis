/**
 * "Wie doet wat?" (Frits' first chat with the real bot, 2026-10-02): a read of the chores list says, per chore, who holds
 * it — as far as the household's names setting lets the person asking see names. Where names are hidden, a held chore
 * says it is taken, without the name; an open one says nobody has it yet.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';

import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);

describe('who holds which chore', () => {
  let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); });

  it('the chores read names the holder, within the names setting', async () => {
    agent = await createRealHouseholdAgent({ seedDemoData: false, seedHousehold: false, t, ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows });
    const own = (a, o, x, c) => agent.callSkill(a, o, x, c);
    await ensureHouseholdLists({ callSkill: (a, o, x) => own(a, o, x), t });
    for (const [w, n, r] of [['telegram:1', 'Ann', 'member'], ['telegram:2', 'Bert', 'member'], ['telegram:9', 'Frits', 'admin']]) {
      await own('stoop', 'addContact', { webid: w, channel: 'telegram', role: r, displayName: n });
      await agent.setDoorCaller(w, r);
    }
    await own('lists', 'addToList', { list: 'Klusjes', text: 'ramen', assignee: 'mij' }, { caller: 'telegram:1' });
    await own('lists', 'addToList', { list: 'Klusjes', text: 'vuilnis' }, { caller: 'telegram:2' });
    const read = async (who) => (await own('lists', 'listEntries', { list: 'Klusjes' }, { caller: who })).items.map((i) => i.label);

    const asBert = await read('telegram:2');
    expect(asBert.find((l) => l.includes('ramen'))).toContain('Ann');
    expect(asBert.find((l) => l.includes('vuilnis'))).toContain('circle.lists.chore_open');

    await own('params', 'set-param', { key: 'assistant.names', value: 'admin' });
    const hidden = await read('telegram:2');
    expect(hidden.find((l) => l.includes('ramen'))).not.toContain('Ann');
    expect(hidden.find((l) => l.includes('ramen'))).toContain('circle.lists.chore_taken');
    expect((await read('telegram:9')).find((l) => l.includes('ramen'))).toContain('Ann');

    // the chore's state stays on the entry (a screen offers "I'll do it" on an open one, "Done" on a held one) — still
    // without anyone's id; and whether it is the reader's own
    const rows = async (who) => (await own('lists', 'listEntries', { list: 'Klusjes' }, { caller: who })).items;
    const forBert = await rows('telegram:2');
    expect(forBert.find((i) => i.label.includes('ramen'))).toMatchObject({ state: 'claimed' });
    expect(forBert.find((i) => i.label.includes('vuilnis'))).toMatchObject({ state: 'open' });
    expect(JSON.stringify(forBert)).not.toContain('telegram:1');
    expect((await rows('telegram:1')).find((i) => i.label.includes('ramen'))).toMatchObject({ yours: true });
  }, 120_000);
});
