/**
 * One refusal shape. Every check that can say no — the tier, the door's map, the role, the op's own rule, the door's
 * settings — answers `null` (go on) or `{layer, code, message?}`, and the checks run in ONE written order, deny-wins
 * (a later check never re-allows what an earlier one refused). The order is written once in `docs/architecture.md`
 * ("the order, written once"); the code's layer list is pinned to it, so whoever changes one changes both.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VaultNodeFs } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { GATE_LAYERS, isRefusal } from '../src/v2/refusal.js';
import { BOT_DOOR_RUNGS } from '../src/v2/botRungs.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);

describe('one refusal shape, one order', () => {
  let dir;
  let agent;
  afterAll(async () => {
    await agent?.stop?.().catch(() => {});
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it('the order is written once, in the architecture, and the code follows it', () => {
    const doc = readFileSync(path.join(HERE, '../../../docs/architecture.md'), 'utf8');
    const line = doc.split('\n').find((l) => l.includes('**The order, written once:**'));
    expect(line, 'docs/architecture.md names the order').toBeTruthy();
    const written = [...line.matchAll(/`([a-z-]+)`/g)].map((m) => m[1]);
    expect(written).toEqual([...GATE_LAYERS]);
    // the bot's door checks are those layers, in that order
    const at = BOT_DOOR_RUNGS.map((layer) => GATE_LAYERS.indexOf(layer));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('each check that says no says which layer and why; a refused call carries it, with words for the person', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-refusal-'));
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
    for (const [webid, role, displayName] of [['telegram:1', 'member', 'Frits'], ['telegram:2', 'observer', 'Olga'], ['telegram:3', 'member', 'Bert']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    expect(await agent.doorRefusal('addToList', 'telegram:1')).toBeNull();
    expect(await agent.doorRefusal('reassignTask', 'telegram:1')).toMatchObject({ layer: 'tier' });
    expect(await agent.doorRefusal('addItem', 'telegram:1')).toMatchObject({ layer: 'door-map', code: 'not-on-this-door' });
    expect(await agent.doorRefusal('addToList', 'telegram:2')).toMatchObject({ layer: 'door-role', code: 'role' });

    const refused = await agent.callSkill('lists', 'addToList', { list: 'Boodschappen', text: 'melk' }, { caller: 'telegram:2' });
    expect(refused.ok).toBe(false);
    expect(isRefusal(refused.refusal)).toBe(true);
    expect(refused.refusal).toMatchObject({ layer: 'door-role', code: 'role' });
    expect(String(refused.error)).toContain('circle.refusal.role');

    // the op's own rule says no in the same shape (a member may not give a chore to someone else) …
    const byRole = await agent.callSkill('lists', 'addToList', { list: 'Klusjes', text: 'ramen', assignee: 'Bert' }, { caller: 'telegram:1' });
    expect(byRole.refusal).toMatchObject({ layer: 'op-rule', code: 'cannot-reassign' });
    // … and so does a door setting (nobody gives chores to others)
    await own('params', 'set-param', { key: 'assistant.assignPolicy', value: 'self' });
    await own('stoop', 'addContact', { webid: 'telegram:1', channel: 'telegram', role: 'coordinator', displayName: 'Frits' });
    const bySetting = await agent.callSkill('lists', 'addToList', { list: 'Klusjes', text: 'ramen', assignee: 'Bert' }, { caller: 'telegram:1' });
    expect(bySetting.refusal).toMatchObject({ layer: 'door-settings', code: 'setting:assign' });
  }, 180_000);

  it('every code the door\'s checks can give has words for the person', async () => {
    const nl = JSON.parse(readFileSync(path.join(HERE, '../src/locales/circle.nl.json'), 'utf8'));
    for (const code of ['role', 'not-on-this-door', 'no-gate', 'INSUFFICIENT_TIER', 'NOT_SELF', 'DISABLED', 'NOT_FOUND', 'NO_TOKEN', 'INVALID_TOKEN', 'refused']) {
      expect(nl.refusal?.[code]?.text, code).toBeTruthy();
    }
  });
});

