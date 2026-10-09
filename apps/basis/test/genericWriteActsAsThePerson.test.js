/**
 * A generic write ("declare a noun → get CRUD free") is made by the PERSON at the door, not by the device. The generic
 * dispatch recorded `by: chatId.pubKey` — on a household bot every note anyone wrote was "made by the bot", so whose it
 * was could never be judged. It acts as the door's caller now, as chores and appointments do (`actorOf`).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const ANN = 'telegram:1';

describe('a generic write at a door', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('records the person who wrote it, not the device', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'generic-actor-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows,
    });
    await agent.callSkill('stoop', 'addContact', { webid: ANN, channel: 'telegram', role: 'member', displayName: 'Ann' });
    await agent.setDoorCaller(ANN, 'member');
    const add = encodeGenericOpId('household', 'add', 'note');
    const made = await agent.callSkill('household', add, { body: 'de vuilnis gaat dinsdag buiten' }, { caller: ANN });
    expect(made?.ok, JSON.stringify(made)).toBe(true);
    // the item as stored (a people-written noun's add answers in words; `get` hands back the item itself)
    const got = await agent.callSkill('household', encodeGenericOpId('household', 'get', 'note'), { id: made.itemId });   // read as the box's owner (get is no door op)
    expect((got?.result ?? got)?.item?.createdBy, `the person who wrote it (${JSON.stringify(got)})`).toBe(ANN);
  }, 60_000);
});
