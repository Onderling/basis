/**
 * What a household bot keeps of a circle it joined, and lets go of: the household's export and reminders read the
 * household by name (never a joined circle, whatever circle is active), and leaving a circle forgets that circle's
 * content on the box — its store's rows and its entries on the device log — while the household stays whole.
 *
 * Composed the way the box composes the bot: the real agent with the bot's store options and a device log.
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
import { EventLog } from '../src/eventLog.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const JOINED = 'joined-circle-1';

describe('a household bot lets go of a circle it left', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the export and reminders read the household only; the forget drops the joined circle, never the household', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-forgets-circle-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    const deviceLog = new EventLog({ initial: [], muted: [] });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
      // a shell that names another circle active must not move the export
      getActiveCircleId: () => JOINED,
      deviceLog,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    const HOME = agent.householdCircleId;   // the household's own circle id, derived from the bot's key
    await ensureHouseholdLists({ callSkill: (a, o, x) => own(a, o, { ...x, circleId: HOME }), t });
    await own('lists', 'addToList', { list: 'Boodschappen', text: 'thuis-melk', circleId: HOME });
    await own('lists', 'createList', { text: 'Kring-lijst', circleId: JOINED });
    await own('lists', 'addToList', { list: 'Kring-lijst', text: 'kring-geheim', circleId: JOINED });
    deviceLog.append({ id: 'joined-msg', ts: Date.now(), app: 'circle', type: 'chat-message', circleId: JOINED, payload: { text: 'kring-geheim' } });
    deviceLog.append({ id: 'house-msg', ts: Date.now(), app: 'circle', type: 'chat-message', circleId: HOME, payload: { text: 'thuis' } });

    const exported = JSON.stringify(await agent.householdItems());
    expect(exported).toContain('thuis-melk');
    expect(exported).not.toContain('kring-geheim');
    expect(JSON.stringify(await agent.reminderSources())).not.toContain('kring-geheim');

    expect(await agent.forgetCircleContent(HOME)).toMatchObject({ ok: false });
    expect(await agent.forgetCircleContent('household')).toMatchObject({ ok: false });
    expect(await agent.forgetCircleContent('')).toMatchObject({ ok: false });

    const r = await agent.forgetCircleContent(JOINED);
    expect(r.ok).toBe(true);
    expect(r.rows).toBeGreaterThan(0);
    expect(JSON.stringify(await own('lists', 'listLists', { circleId: JOINED }))).not.toContain('Kring-lijst');
    expect(JSON.stringify(await own('lists', 'listEntries', { list: 'Kring-lijst', circleId: JOINED }))).not.toContain('kring-geheim');
    expect(JSON.stringify(await agent.householdItems())).toContain('thuis-melk');
    expect(deviceLog.query().filter((e) => e.circleId === JOINED)).toEqual([]);
    expect(deviceLog.query().map((e) => e.id)).toContain('house-msg');
  }, 120_000);
});
