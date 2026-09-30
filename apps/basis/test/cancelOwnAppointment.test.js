/**
 * A member may cancel their OWN appointment (Frits, 2026-09-30), as they may remove their own list entries; the admin
 * may cancel any. The admin can switch it off (`assistant.cancelPolicy`: own — the default — · admin: only the admin).
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

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const day = (() => { const d = new Date(Date.now() + 86_400_000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

describe('cancelling an appointment', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('a member cancels their own, not another\'s; the admin any; the admin can make it admin-only', async () => {
    expect(BOT_OP_MAP.member).toContain('cancelEvent');
    dir = await mkdtemp(path.join(tmpdir(), 'bot-cancel-'));
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
    for (const [webid, role, displayName] of [['telegram:1', 'member', 'Frits'], ['telegram:2', 'member', 'Bert'], ['telegram:9', 'admin', 'Anne']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    await as('telegram:1')('calendar', 'addEvent', { title: 'tandarts', when: `${day}T10:00` });
    await as('telegram:2')('calendar', 'addEvent', { title: 'kapper', when: `${day}T11:00` });

    // Bert may not cancel Frits' appointment; Frits may cancel his own
    const notYours = await as('telegram:2')('calendar', 'cancelEvent', { id: 'tandarts' });
    expect(notYours.ok).toBe(false);
    expect(notYours.refusal).toMatchObject({ layer: 'op-rule', code: 'not-yours' });
    expect((await as('telegram:1')('calendar', 'cancelEvent', { id: 'tandarts' })).ok).toBe(true);

    // the admin switches it to admin-only: Bert can no longer cancel his own; the admin still can
    await own('params', 'set-param', { key: 'assistant.cancelPolicy', value: 'admin' });
    const off = await as('telegram:2')('calendar', 'cancelEvent', { id: 'kapper' });
    expect(off.refusal).toMatchObject({ layer: 'door-settings', code: 'setting:cancel' });
    expect((await as('telegram:9')('calendar', 'cancelEvent', { id: 'kapper' })).ok).toBe(true);
  }, 180_000);
});
