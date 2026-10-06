/**
 * "Ik ben bij de Lidl" (a household member's idea, 2026-10-06): general shopping lists and shop-specific ones — at a
 * shop, the person gets BOTH: the household's shopping list (the template's shopping role, never a name) and every list
 * whose name mentions that shop. A shop with no list of its own is the model's to answer ("ik ben bij de tandarts").
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists, templateLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows, BOT_OP_MAP } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { listsGateRules } from '../src/v2/circleGate.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const route = (text, lang = 'nl') => {
  for (const r of listsGateRules(lang, templateLists(t))) { const hit = r.test instanceof RegExp ? r.test.test(text) : r.test(text); if (hit) { const c = r.command(text); if (c) return { id: r.id, ...c }; } }
  return null;
};

describe('at the shop', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the words: "ik ben bij de Lidl" is the shop visit, with the general list; "…geweest" is not', () => {
    expect(BOT_OP_MAP.member).toContain('shopVisit');
    expect(route('ik ben bij de Lidl')).toMatchObject({ opId: 'shopVisit', args: { shop: 'Lidl', general: 'Boodschappen' }, fallback: 'model' });
    expect(route('Ik ben nu in de Albert Heijn')).toMatchObject({ opId: 'shopVisit', args: { shop: 'Albert Heijn' } });
    expect(route("I'm at the Lidl", 'en')).toMatchObject({ opId: 'shopVisit', args: { shop: 'Lidl' } });
    expect(route('ik ben bij de tandarts geweest')?.opId).not.toBe('shopVisit');
  });

  it('the general list and the shop\'s own lists together; a shop without a list is the model\'s', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'at-shop-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    await own('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    await own('lists', 'createList', { text: 'Lidl' });
    await own('lists', 'addToList', { list: 'Lidl', text: 'chips' });
    await own('lists', 'createList', { text: 'Drogist' });
    await own('lists', 'addToList', { list: 'Drogist', text: 'tandpasta' });

    const r = await own('lists', 'shopVisit', { shop: 'Lidl', general: 'Boodschappen' });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.message).toContain('melk');
    expect(r.message).toContain('chips');
    expect(r.message).not.toContain('tandpasta');
    expect((await own('lists', 'shopVisit', { shop: 'lidl', general: 'Boodschappen' })).message).toContain('chips');   // case aside
    expect(await own('lists', 'shopVisit', { shop: 'tandarts', general: 'Boodschappen' })).toMatchObject({ ok: false, code: 'not-found' });
  }, 120_000);
});
