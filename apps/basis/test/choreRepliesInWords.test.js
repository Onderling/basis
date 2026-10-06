/**
 * Every chore action answers in words: what happened, and to which chore. The buttons walk found three that said only
 * "✓" — removing a chore, giving it to someone, editing it (the admin's, and every member's under the flat roles) — a
 * person tapping them on a screen could not tell what had happened, or to what.
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
import nl from '../src/locales/circle.nl.json' with { type: 'json' };

const tr = (k, p) => { const v = k.split('.').slice(1).reduce((o, x) => o?.[x], nl); const s = typeof v === 'string' ? v : (v?.text ?? k); return s.replace(/\{\{(\w+)\}\}/g, (_, n) => String(p?.[n] ?? '')); };
const ADMIN = 'telegram:9';
const HENK = 'telegram:1';

describe('chore actions answer in words', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('remove, give to someone, edit: each says what happened and to which chore', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'chore-words-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows, t: tr,
    });
    const own = (a, o, x) => agent.callSkill(a, o, x);
    await ensureHouseholdLists({ callSkill: own, t: tr });
    for (const [webid, role, displayName] of [[ADMIN, 'admin', 'Frits'], [HENK, 'member', 'Henk']]) {
      await own('stoop', 'addContact', { webid, channel: 'telegram', role, displayName });
      await agent.setDoorCaller(webid, role);
    }
    const as = (a, o, x) => agent.callSkill(a, o, x, { caller: ADMIN });
    const chore = async (text) => { await as('lists', 'addToList', { list: 'Klusjes', text }); return ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === text)?.id; };
    const bare = (m) => !m || /^\s*✓\s*$/.test(String(m));

    const ramen = await chore('ramen lappen');
    const given = await as('tasks', 'reassignTask', { id: ramen, newAssignee: HENK });
    expect(given.ok, JSON.stringify(given)).not.toBe(false);
    expect(bare(given.message), `reassign said: ${given.message}`).toBe(false);
    expect(given.message).toContain('ramen lappen');

    const edited = await as('tasks', 'editTask', { id: ramen, text: 'ramen wassen' });
    expect(bare(edited.message), `edit said: ${edited.message}`).toBe(false);
    expect(edited.message).toContain('ramen wassen');

    // an edit that changes nothing (a form sent as it stood) still says which chore it was about
    const same = await as('tasks', 'editTask', { id: ramen });
    expect(bare(same.message), `an empty edit said: ${JSON.stringify(same).slice(0, 200)}`).toBe(false);
    expect(same.message).toContain('ramen wassen');

    const removed = await as('tasks', 'removeTask', { id: ramen });
    expect(bare(removed.message), `remove said: ${removed.message}`).toBe(false);
    expect(removed.message).toContain('ramen wassen');
  }, 120_000);
});
