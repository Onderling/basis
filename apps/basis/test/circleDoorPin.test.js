/**
 * The circle door pins ITS circle: a call that carries a door's person AND the circle the door composed for
 * (`ctx.doorCircleId`, set by the host, never by the person) lands in that circle — lists, chores, appointments —
 * whatever circle the args name; the household stays as it was. Without it, a door's call is the household's, as before.
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
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const CIRCLE = 'joined-circle-x';
const ANN = `circle:${CIRCLE}:ann-ref`;

describe('the circle door pins its circle', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('lists, chores and appointments land in the door\'s circle; the household is unchanged', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'circle-door-pin-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    // the circle's own lists (its members made them)
    await own('lists', 'createList', { text: 'Kringlijst', circleId: CIRCLE });
    await own('lists', 'createList', { text: 'Klusjes', defaultChild: 'task', circleId: CIRCLE });
    await own('lists', 'createList', { text: 'Agenda', defaultChild: 'calendar-event', circleId: CIRCLE });
    await agent.setDoorCaller(ANN, 'member');
    const asAnn = (a, o, x) => agent.callSkill(a, o, x, { caller: ANN, threadId: ANN, doorCircleId: CIRCLE });
    const householdBefore = JSON.stringify(await agent.householdItems());

    expect((await asAnn('lists', 'addToList', { list: 'Kringlijst', text: 'melk', circleId: 'household' })).ok).not.toBe(false);
    expect(JSON.stringify(await own('lists', 'listEntries', { list: 'Kringlijst', circleId: CIRCLE }))).toContain('melk');
    expect(JSON.stringify(await asAnn('lists', 'listLists', {}))).toContain('Kringlijst');
    expect(JSON.stringify(await asAnn('lists', 'listLists', {}))).not.toContain('Boodschappen');

    expect((await asAnn('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen' })).ok).not.toBe(false);
    const claimed = await asAnn('tasks', 'claimTask', { id: 'ramen lappen' });
    expect(claimed.ok, JSON.stringify(claimed)).not.toBe(false);
    expect(JSON.stringify(await asAnn('tasks', 'listMine', {}))).toContain('ramen lappen');

    // a chore another member holds, read in the circle: the household's book does not name them, and under the circle's
    // default reveal policy nobody is named — only "you" for the reader's own
    // Bert is ALSO in the household's book (a linked key), with a household name: it does not reach the circle
    await own('stoop', 'addContact', { webid: `circle:${CIRCLE}:bert-ref`, displayName: 'Bert Huisnaam', channel: 'web', role: 'member' });
    await agent.setDoorCaller(`circle:${CIRCLE}:bert-ref`, 'member');
    await agent.callSkill('lists', 'addToList', { list: 'Klusjes', text: 'vuilnis' }, { caller: `circle:${CIRCLE}:bert-ref`, threadId: 'b', doorCircleId: CIRCLE });
    await agent.callSkill('tasks', 'claimTask', { id: 'vuilnis' }, { caller: `circle:${CIRCLE}:bert-ref`, threadId: 'b', doorCircleId: CIRCLE });
    const chores = JSON.stringify(await asAnn('lists', 'listEntries', { list: 'Klusjes' }));
    expect(chores).toContain('circle.lists.chore_taken');
    expect(chores).not.toContain('bert-ref');
    expect(chores).not.toContain('Bert Huisnaam');
    expect(chores).toContain('circle.lists.chore_you');

    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await asAnn('calendar', 'addEvent', { title: 'kringetentje', when: `${tomorrow}T18:00:00.000Z` })).ok).not.toBe(false);
    expect(JSON.stringify(await asAnn('calendar', 'listEvents', { days: 7 }))).toContain('kringetentje');

    expect(JSON.stringify(await agent.householdItems())).toBe(householdBefore);
    // the household door's call (no door circle) is the household's, as before
    await agent.setDoorCaller('telegram:42', 'member');
    expect(JSON.stringify(await agent.callSkill('lists', 'listLists', {}, { caller: 'telegram:42', threadId: 'telegram:42' }))).toContain('Boodschappen');
  }, 120_000);
});
