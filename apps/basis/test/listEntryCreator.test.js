/**
 * WHO ADDED A LIST ENTRY is the person who asked, as the same internal id the chores record — not the bot's own key, never
 * a name or a handle — and nothing a person reads says it: every list read through the door stays as it was. The person
 * comes from the host (who is asking), never from the call's words: an `actor` or `person` in the args sets nothing.
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

const NAMES = { 'circle.lists.template.shopping': 'Boodschappen', 'circle.lists.template.chores': 'Klusjes', 'circle.lists.template.repairs': 'Reparaties', 'circle.lists.template.schedule': 'Agenda' };
const t = (k, p) => NAMES[k] ?? (p ? `${k} ${JSON.stringify(p)}` : k);
const ANN = 'telegram:111';
const BERT = 'telegram:222';

describe('who added a list entry', () => {
  it('the store records the person the host names, else this device', async () => {
    const registry = createRegistry();
    registerCanonicalTypes(registry);
    const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
    const ops = makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1', localActor: 'me' });
    await ops.createList({ text: 'Boodschappen' });
    const theirs = await ops.addToList({ list: 'Boodschappen', text: 'melk' }, { person: 'person:ann' });
    const own = await ops.addToList({ list: 'Boodschappen', text: 'brood' });
    const words = await ops.addToList({ list: 'Boodschappen', text: 'kaas', actor: 'person:forged', person: 'person:forged' });
    const store = stores.getStore('c1');
    expect((await store.get(theirs.itemId)).createdBy).toBe('person:ann');
    expect((await store.get(own.itemId)).createdBy).toBe('me');
    expect((await store.get(words.itemId)).createdBy, 'the args set nobody').toBe('me');
  });

  describe('through the door', () => {
    let dir; let agent;
    afterAll(async () => { await agent?.stop?.().catch(() => {}); if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); });

    it('the id the chores carry; no read says it; a forged person in the call sets nothing', async () => {
      dir = await mkdtemp(path.join(tmpdir(), 'bot-creator-'));
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
      for (const [webid, displayName] of [[ANN, 'Ann'], [BERT, 'Bert']]) {
        await own('pinboard', 'addContact', { webid, channel: 'telegram', role: 'member', displayName });
        await agent.setDoorCaller(webid, 'member');
      }
      const as = (caller) => (a, o, x) => agent.callSkill(a, o, x, { caller });

      // a chore Ann adds and claims: the id the chores record for her
      expect((await as(ANN)('lists', 'addToList', { list: 'Klusjes', text: 'ramen' })).ok).toBe(true);
      const chores = (await own('tasks', 'listOpen', {})).items ?? [];
      const ramen = chores.find((x) => x.text === 'ramen');
      expect((await as(ANN)('tasks', 'claimTask', { id: ramen.id })).ok).not.toBe(false);
      const claimed = ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.id === ramen.id);
      const annId = claimed.assignee ?? claimed.claimedBy ?? claimed.holders?.[0];
      expect(annId, JSON.stringify(claimed)).toBeTruthy();
      expect(ramen.createdBy, 'her chore names her as its maker, by the id the chores carry').toBe(annId);
      expect(ramen.createdBy).not.toBe('Ann');

      // a forged maker in the call's words: the host's person wins
      expect((await as(BERT)('lists', 'addToList', { list: 'Klusjes', text: 'gras', actor: ANN, person: ANN })).ok).toBe(true);
      const gras = ((await own('tasks', 'listOpen', {})).items ?? []).find((x) => x.text === 'gras');
      expect(gras.createdBy).not.toBe(annId);

      // the bot's own add: nobody's
      await own('lists', 'addToList', { list: 'Boodschappen', text: 'brood' });
      // and Ann's line on the shopping list: none of Bert's reads says who added it
      expect((await as(ANN)('lists', 'addToList', { list: 'Boodschappen', text: 'melk' })).ok).toBe(true);
      for (const [op, args] of [['listEntries', { list: 'Boodschappen' }], ['listEntries', { list: 'Klusjes' }], ['listLists', {}], ['shopVisit', { shop: 'Boodschappen' }], ['listDone', { days: 7 }]]) {
        const read = await as(BERT)('lists', op, args);
        expect(JSON.stringify(read), `${op} names no maker`).not.toContain(ANN);
      }
    }, 60_000);
  });
});
