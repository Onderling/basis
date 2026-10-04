/**
 * A chore named in words, on the household bot ("ik doe de ramen", "de ramen zijn klaar"): claim looks among the chores
 * nobody holds yet, complete among the ones the person holds (Fable, the screen-fields brief: "claim: the open ones;
 * complete: the ones I hold"). So "ramen" is one chore for each, where it was two — "which one?" — before.
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
const ANN = 'telegram:1';
const BERT = 'telegram:2';

describe('a chore named in words matches among the right chores', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('claim: among the ones nobody holds; complete: among the ones I hold', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'chore-words-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t });
    await own('stoop', 'addContact', { webid: ANN, channel: 'telegram', role: 'member' });
    await own('stoop', 'addContact', { webid: BERT, channel: 'telegram', role: 'member' });
    await agent.setDoorCaller(ANN, 'member');
    await agent.setDoorCaller(BERT, 'member');
    const as = (who) => (a, o, x) => agent.callSkill(a, o, x, { caller: who, threadId: who });
    await own('lists', 'addToList', { list: 'Klusjes', text: 'ramen lappen' });
    await own('lists', 'addToList', { list: 'Klusjes', text: 'ramen zemen' });
    expect((await as(ANN)('tasks', 'claimTask', { id: 'ramen lappen' })).ok).not.toBe(false);

    // Bert says "ik doe de ramen": only "ramen zemen" is nobody's — it is that one
    const claimed = await as(BERT)('tasks', 'claimTask', { id: 'ramen' });
    expect(claimed.ok, JSON.stringify(claimed)).not.toBe(false);
    // Ann says "de ramen zijn klaar": she holds only "ramen lappen" — it is that one
    const done = await as(ANN)('tasks', 'completeTask', { id: 'ramen' });
    expect(done.ok, JSON.stringify(done)).not.toBe(false);
    const mine = JSON.stringify(await as(BERT)('tasks', 'listMine', {}));
    expect(mine).toContain('ramen zemen');
  }, 120_000);
});
