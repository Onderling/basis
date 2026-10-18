/**
 * THE HISTORY THROUGH THE BOT'S DOOR names who did what as the reader may see them — their own "jij", a name when the
 * household's names setting lets them, else "iemand" — and NEVER a person's id (the op hands the door the doer's id; the
 * door's ceiling turns it into words, the same as who holds a chore).
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
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const ANN = 'telegram:111';
const BERT = 'telegram:222';
const ADMIN = 'telegram:999';

describe('the history through the door', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('the doer is "you", a name, or someone — never an id', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bot-history-'));
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
    for (const [webid, role, displayName] of [[ANN, 'member', 'Ann'], [BERT, 'member', 'Bert'], [ADMIN, 'admin', 'Anne']]) {
      await own('pinboard', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });
    await as(ADMIN)('lists', 'addToList', { list: 'Klusjes', text: 'ramen' });
    const ramen = ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === 'ramen')?.id;
    expect((await as(ANN)('tasks', 'claimTask', { id: ramen })).ok).not.toBe(false);
    expect((await as(ANN)('tasks', 'completeTask', { id: ramen })).ok).not.toBe(false);

    const mine = await as(ANN)('lists', 'listDone', { days: 7 });
    const row = (mine.items ?? []).find((i) => i.label === 'ramen');
    expect(row, JSON.stringify(mine)).toBeTruthy();
    expect(row.by, 'the doer reads her own as "you"').toEqual({ you: true });
    expect(JSON.stringify(mine), 'no id leaves the door').not.toContain(ANN);
    const theirs = await as(BERT)('lists', 'listDone', { days: 7 });
    const seen = (theirs.items ?? []).find((i) => i.label === 'ramen');
    expect(seen.by.you).toBeUndefined();
    expect(seen.by.name ?? (seen.by.someone ? 'someone' : null), 'a name or someone, never an id').toBeTruthy();
    expect(JSON.stringify(theirs)).not.toContain(ANN);
  }, 60_000);
});
