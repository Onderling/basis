/**
 * THE TRASH: an entry someone takes off ANOTHER person's list is kept aside — out of every read, the history and the
 * chores — for its maker or an admin to put back (`/prullenbak`), for the same window as a removed list, then dropped by
 * the same sweep. One's own entry (or this device's own call) goes for good, as before. Through the door, who took it
 * off is said as the reader may see them — never an id.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { VaultNodeFs } from '@onderling/vault';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { ensureHouseholdLists } from '../src/v2/householdTemplate.js';
import { botOpLevel, botRoleAllows } from '../src/v2/botOpMap.js';
import { HOUSEHOLD_BOT_STORE_OPTS } from '../src/v2/householdBotStore.js';
import { makeListsOps } from '../src/v2/listsOps.js';
import { replyFact, replyLine, replyLines } from '../src/v2/replyLine.js';

const DAY = 86_400_000;
const as = (person, role = 'member') => ({ person, personRole: async () => role });

function world() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const clock = { now: Date.UTC(2026, 9, 18) };
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  const ops = makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1', now: () => clock.now });
  return { ops, clock, store: stores.getStore('c1') };
}
const lines = async (ops, list) => ((await ops.listEntries({ list })).items ?? []).map((i) => i.label);

describe('the trash', () => {
  it("one's own entry goes for good; someone else's goes to the trash, out of every read", async () => {
    const { ops, store } = world();
    await ops.createList({ text: 'Boodschappen' });
    await ops.addToList({ list: 'Boodschappen', text: 'melk' }, as('ann'));
    await ops.addToList({ list: 'Boodschappen', text: 'brood' }, as('ann'));
    await ops.markListItemDone({ list: 'Boodschappen', item: 'melk' }, as('ann'));
    await ops.addToList({ list: 'Boodschappen', text: 'kaas' }, as('ann'));

    const own = await ops.removeFromList({ list: 'Boodschappen', item: 'kaas' }, as('ann'));
    expect(own.ok && !own.trashed).toBe(true);
    const theirs = await ops.removeFromList({ list: 'Boodschappen', item: 'brood' }, as('bert'));
    expect(theirs.trashed, JSON.stringify(theirs)).toBe(true);
    expect(await lines(ops, 'Boodschappen')).toEqual([]);
    expect(((await ops.listDone({ days: 7 })).items ?? []).map((i) => i.label)).toEqual(['melk']);
    const kept = await store.listByType('removed-entry');
    expect(kept.map((r) => [r.name, r.removedBy, r.createdBy])).toEqual([['brood', 'bert', 'ann']]);
  });

  it('the maker and an admin see it and put it back; nobody else does', async () => {
    const { ops } = world();
    await ops.createList({ text: 'Boodschappen' });
    await ops.addToList({ list: 'Boodschappen', text: 'brood' }, as('ann'));
    await ops.removeFromList({ list: 'Boodschappen', item: 'brood' }, as('bert'));

    expect((await ops.restoreEntry({}, as('bert'))).items).toEqual([]);
    expect((await ops.restoreEntry({ item: 'brood' }, as('bert'))).code, 'not his to put back').toBe('not-found');
    const hers = await ops.restoreEntry({}, as('ann'));
    expect(hers.items.map((r) => [r.label, r.list, r.removedBy])).toEqual([['brood', 'Boodschappen', 'bert']]);
    expect(hers.quickReplies.map((q) => q.slash)).toEqual(['/prullenbak brood']);
    expect((await ops.restoreEntry({}, as('carla', 'admin'))).items.length, 'an admin sees all of it').toBe(1);

    const back = await ops.restoreEntry({ item: 'brood' }, as('ann'));
    expect(back.ok, JSON.stringify(back)).toBe(true);
    expect(await lines(ops, 'Boodschappen')).toEqual(['brood']);
    expect((await ops.restoreEntry({}, as('ann'))).items).toEqual([]);
  });

  it("this device's own call takes it off for good (no person known); past the window the trash is empty", async () => {
    const { ops, clock, store } = world();
    await ops.createList({ text: 'Boodschappen' });
    await ops.addToList({ list: 'Boodschappen', text: 'brood' }, as('ann'));
    await ops.addToList({ list: 'Boodschappen', text: 'thee' }, as('ann'));
    expect((await ops.removeFromList({ list: 'Boodschappen', item: 'brood' })).trashed).toBeUndefined();
    await ops.removeFromList({ list: 'Boodschappen', item: 'thee' }, as('bert'));
    clock.now += 29 * DAY;
    expect((await ops.restoreEntry({}, as('ann'))).items.length).toBe(1);
    clock.now += 2 * DAY;
    expect((await ops.restoreEntry({}, as('ann'))).items).toEqual([]);
    expect(await store.listByType('removed-entry'), 'dropped by the sweep').toEqual([]);
  });

  it('/list-restore never offers an entry from the trash, and the trash never offers a list', async () => {
    const { ops } = world();
    await ops.createList({ text: 'Boodschappen' });
    await ops.createList({ text: 'Feest' });
    await ops.addToList({ list: 'Boodschappen', text: 'brood' }, as('ann'));
    await ops.removeFromList({ list: 'Boodschappen', item: 'brood' }, as('bert'));
    await ops.removeList({ list: 'Feest' }, as('ann'));
    expect((await ops.restoreList({})).quickReplies.map((q) => q.slash)).toEqual(['/list-restore Feest']);
    expect((await ops.restoreList({ list: 'brood' })).code).toBe('not-found');
    expect((await ops.restoreEntry({}, as('ann', 'admin'))).items.map((r) => r.label)).toEqual(['brood']);
    expect((await ops.restoreEntry({ item: 'Feest' }, as('ann', 'admin'))).code).toBe('not-found');
  });

  it('an entry whose list is gone does not come back on its own', async () => {
    const { ops } = world();
    await ops.createList({ text: 'Feest' });
    await ops.addToList({ list: 'Feest', text: 'slingers' }, as('ann'));
    await ops.removeFromList({ list: 'Feest', item: 'slingers' }, as('bert'));
    await ops.removeList({ list: 'Feest' }, as('ann'));
    const r = await ops.restoreEntry({ item: 'slingers' }, as('ann'));
    expect(r.ok).toBe(false);
    expect(r.error).toContain('trash_list_gone');
  });

  it('the words: a take-off into the trash says so (folded per list); the trash reads a row each, who as worded', () => {
    const t = (k, v) => `${k}${v ? ' ' + JSON.stringify(v) : ''}`;
    const trashed = (entry) => replyFact({ ok: true, trashed: true, entry, list: 'Boodschappen' }, { opId: 'lists.removeFromList' });
    const [line] = replyLines([trashed('brood'), trashed('kaas')], { t });
    expect(line).toContain('circle.lists.removed_to_trash_many');
    expect(line).toContain('"count":2');
    const read = replyLine({ ok: true, items: [{ label: 'brood', list: 'Boodschappen', removedAt: '2026-10-18T10:00:00Z', by: { name: 'Bert' } }] }, { opId: 'lists.restoreEntry', t });
    expect(read.split('\n')[0]).toMatch(/^circle.reply.trash_head/);
    expect(read).toContain('circle.reply.trash_row_by');
    expect(read).toContain('Bert');
    expect(replyLine({ ok: true, items: [], message: 'circle.lists.trash_none' }, { opId: 'lists.restoreEntry', t })).toBe('circle.lists.trash_none');
  });

  describe('through the door', () => {
    const ANN = 'telegram:111';
    const BERT = 'telegram:222';
    const ADMIN = 'telegram:999';
    const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
    const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
    let dir; let agent;
    afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

    it('who took it off is a name or someone, never an id; the role comes from the roster, not the call', async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'bot-trash-'));
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
      const door = (caller, extra = {}) => (a, o, x) => agent.callSkill(a, o, x, { caller, ...extra });

      expect((await door(ANN)('lists', 'addToList', { list: 'Boodschappen', text: 'brood' })).ok).toBe(true);
      expect((await door(ANN)('lists', 'addToList', { list: 'Klusjes', text: 'ramen' })).ok).toBe(true);
      expect((await door(BERT)('lists', 'removeFromList', { list: 'Boodschappen', item: 'brood' })).trashed).toBe(true);
      expect((await door(BERT)('lists', 'removeFromList', { list: 'Klusjes', item: 'ramen' })).trashed).toBe(true);
      // a chore in the trash is no chore: not open, not anyone's
      expect(((await own('tasks', 'listOpen', {})).items ?? []).some((x) => x.text === 'ramen')).toBe(false);

      // a forged role in the call: Bert is still a member, and sees none of Ann's
      const forged = await door(BERT, { personRole: async () => 'admin', person: ADMIN })('lists', 'restoreEntry', {});
      expect(forged.items ?? []).toEqual([]);

      const hers = await door(ANN)('lists', 'restoreEntry', {});
      expect(hers.items.map((r) => r.label).sort()).toEqual(['brood', 'ramen']);
      for (const r of hers.items) expect(r.by?.name ?? (r.by?.someone ? 'someone' : null), 'who took it off, worded').toBeTruthy();
      expect(JSON.stringify(hers)).not.toContain(BERT);
      expect(JSON.stringify(hers)).not.toMatch(/"removedBy"/);
      expect((await door(ADMIN)('lists', 'restoreEntry', {})).items.length, 'the admin sees all of it').toBe(2);

      expect((await door(ANN)('lists', 'restoreEntry', { item: 'ramen' })).ok).toBe(true);
      expect(((await own('tasks', 'listOpen', {})).items ?? []).some((x) => x.text === 'ramen'), 'the chore is back').toBe(true);
    }, 60_000);
  });
});
