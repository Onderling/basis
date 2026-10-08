/**
 * "geef de ramen aan Bob": a chore given to someone by the name a person says is given to THAT person — the household's
 * Bob, by his id — so his reminders and his "mijn klusjes" see it. The name is read as a chore's who is read when it is
 * added ("nieuwe taak voor Bob: …"): the same people, the same names ceiling, the same refusal for a name nobody has.
 * Before: the word itself was stored as the holder, and the chore belonged to nobody the household knows.
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
import { replyLine } from '../src/v2/replyLine.js';

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, vars) => NAMES[k] ?? (vars ? `${k} ${JSON.stringify(vars)}` : k);
const ADMIN = 'telegram:9';
const BOB = 'telegram:2';

describe('a chore given by a name', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('goes to the person of that name; a name nobody has is refused; under hidden names it is not given by name', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'chore-reassign-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    for (const [webid, role, displayName] of [[ADMIN, 'admin', 'Frits'], [BOB, 'member', 'Bob']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    const chore = async (text) => { await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text }); return ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === text); };
    const holders = (task) => [...new Set([...(Array.isArray(task?.assignees) ? task.assignees : []), task?.assignee].filter(Boolean))];
    const now = async (id) => ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.id === id);

    // the admin gives "ramen" to Bob, by the name: Bob holds it, and it is among his own
    const ramen = await chore('ramen lappen');
    const given = await as(ADMIN)('tasks', 'reassignTask', { id: ramen.id, newAssignee: 'Bob' });
    expect(given.ok, JSON.stringify(given)).not.toBe(false);
    expect(holders(await now(ramen.id))).toEqual([BOB]);
    const bobs = (await as(BOB)('tasks', 'listMine', {})).items ?? [];
    expect(bobs.map((x) => x.id)).toContain(ramen.id);
    // the line the door says names him as the household knows him, and never his id
    const line = replyLine(given, { opId: 'reassignTask', t });
    expect(line).toContain('circle.reply.chore_theirs');
    expect(line).toContain('Bob');
    expect(line).not.toContain(BOB);

    // a name nobody in the household has: refused, in words, and the chore stays Bob's
    const nobody = await as(ADMIN)('tasks', 'reassignTask', { id: ramen.id, newAssignee: 'Zorro' });
    expect(nobody.ok).toBe(false);
    expect(String(nobody.error)).toContain('circle.tasks.no_such_person');
    expect(holders(await now(ramen.id))).toEqual([BOB]);

    // names hidden from everyone: a chore is not given by a name (the answer would say who exists)
    const glas = await chore('glas wegbrengen');
    await own('params', 'set-param', { key: 'assistant.names', value: 'none' });
    const hidden = await as(ADMIN)('tasks', 'reassignTask', { id: glas.id, newAssignee: 'Bob' });
    expect(hidden.ok).toBe(false);
    expect(String(hidden.error)).toContain('circle.tasks.names_hidden');
    expect(holders(await now(glas.id))).toEqual([]);
    // …and "mij" is still the asker's own, whatever the names setting
    const mine = await as(ADMIN)('tasks', 'reassignTask', { id: glas.id, newAssignee: 'mij' });
    expect(mine.ok, JSON.stringify(mine)).not.toBe(false);
    expect(holders(await now(glas.id))).toEqual([ADMIN]);
    await own('params', 'set-param', { key: 'assistant.names', value: 'members' });
  }, 120_000);
});
