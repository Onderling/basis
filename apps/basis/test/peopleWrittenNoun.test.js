/**
 * A noun PEOPLE write (`nouns[noun].writtenBy: 'people'`) — a manifest facet, generic, never a special case for the
 * household's notes: the noun's generic WRITE atoms carry no chat surface (the model gets no tool to write or remove
 * one; it may read), the validator refuses a writer it does not know, and through a household bot's door an item is
 * removed only by the one who made it or an admin.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { validateManifest, encodeGenericOpId } from '@onderling/app-manifest';
import { synthesizeGenericOps } from '../src/genericOpSynth.js';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';

const base = (nouns) => ({ app: 'kring', hosts: [], itemTypes: Object.keys(nouns), nouns, operations: [] });

describe('the writtenBy facet', () => {
  it('a second people-written noun: its writes are no model tool, its reads are', () => {
    const ops = synthesizeGenericOps(base({ contact: { atoms: ['add', 'list', 'remove'], writtenBy: 'people' } }));
    const chat = Object.fromEntries(ops.map((o) => [o.verb, Boolean(o.surfaces.chat)]));
    expect(chat).toEqual({ add: false, list: true, remove: false });
    expect(ops.every((o) => o.surfaces.slash)).toBe(true);   // people still type them
  });

  it('a noun without it keeps every atom a tool (unchanged)', () => {
    const ops = synthesizeGenericOps(base({ contact: { atoms: ['add', 'remove'] } }));
    expect(ops.every((o) => o.surfaces.chat)).toBe(true);
  });

  it('the validator refuses a writer it does not know', () => {
    const bad = validateManifest(base({ contact: { atoms: ['add'], writtenBy: 'robots' } }));
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad.errors)).toMatch(/writtenBy/);
    expect(validateManifest(base({ contact: { atoms: ['add'], writtenBy: 'people' } })).errors?.filter((e) => /writtenBy/.test(e.message)) ?? []).toEqual([]);
  });
});

const ANN = 'telegram:1'; const BOB = 'telegram:2'; const ADMIN = 'telegram:9';
const op = (atom) => encodeGenericOpId('household', atom, 'note');

describe('the household\'s notes through a bot\'s door', () => {
  let dir; let agent;
  afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

  it('written, read, refused to another member, taken away by the admin or the maker — named by their words', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'notes-door-'));
    const pass = randomBytes(32).toString('base64url');
    await writeFile(path.join(dir, 'vault.passphrase'), pass, { mode: 0o600 });
    agent = await createRealHouseholdAgent({
      ownerRootVault: new VaultNodeFs(path.join(dir, 'vault.json'), pass), chatVault: new VaultNodeFs(path.join(dir, 'chat-vault.json'), pass),
      householdPersistDb: { path: path.join(dir, 'household-items.json') }, seedDemoData: false, seedHousehold: false,
      ...HOUSEHOLD_BOT_STORE_OPTS, doorOpLevel: botOpLevel, doorRoleAllows: botRoleAllows,
    });
    for (const [webid, role] of [[ANN, 'member'], [BOB, 'member'], [ADMIN, 'admin']]) {
      await agent.callSkill('stoop', 'addContact', { webid, channel: 'telegram', role, displayName: webid });
      await agent.setDoorCaller(webid, role);
    }
    const as = (caller) => (atom, args) => agent.callSkill('household', op(atom), args, { caller });
    expect((await as(ANN)('add', { body: 'de wifi-code staat op de koelkast' })).ok).toBe(true);
    expect((await as(BOB)('add', { body: 'Bob is vegetariër' })).ok).toBe(true);
    const bodies = async () => ((await as(BOB)('list', {}))?.items ?? []).map((i) => i.label).sort();
    expect(await bodies()).toEqual(['Bob is vegetariër', 'de wifi-code staat op de koelkast']);
    const refused = await as(BOB)('remove', { id: 'wifi-code' });
    expect(refused).toMatchObject({ ok: false, code: 'forbidden' });
    expect(await bodies()).toHaveLength(2);
    expect((await as(ADMIN)('remove', { id: 'wifi-code' })).ok).toBe(true);
    expect((await as(BOB)('remove', { id: 'vegetariër' })).ok).toBe(true);
    expect(await bodies()).toEqual([]);
  }, 60_000);
});
