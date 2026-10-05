/**
 * A removed list can be put back for 30 days (Frits 2026-10-05: "everyone may remove, 30 days to restore"). Removing
 * moves the list and everything under it aside (out of every read, as before) and keeps them, whole, in the circle;
 * `restoreList` without a name shows what can come back, with a name it puts that list back — its lines, its chores
 * and their holders. After 30 days it is gone for good. Removing is everyone's on the bot.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeListsOps } from '../src/v2/listsOps.js';
import { BOT_OP_MAP, botOpLevel } from '../src/v2/botOpMap.js';

const DAY = 86_400_000;
function world() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const clock = { now: Date.UTC(2026, 9, 5) };
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  const ops = makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1', now: () => clock.now });
  return { ops, clock, store: stores.getStore('c1') };
}
const names = async (ops) => ((await ops.listLists({})).items ?? []).map((i) => i.label ?? i.text);
const lines = async (ops, list) => ((await ops.listEntries({ list })).items ?? []).map((i) => i.label ?? i.text);

describe('removing a list, and putting it back', () => {
  it('removed: out of every read; restore lists it; restored: the list and its lines are back', async () => {
    const { ops, store } = world();
    await ops.createList({ text: 'Boodschappen' });
    await ops.createList({ text: 'Feest' });
    await ops.addToList({ list: 'Feest', text: 'slingers' });
    await ops.addToList({ list: 'Feest', text: 'taart' });
    const gone = await ops.removeList({ list: 'Feest' }, { caller: 'telegram:7' });
    expect(gone.ok, JSON.stringify(gone)).toBe(true);
    expect(await names(ops)).toEqual(['Boodschappen']);
    expect((await ops.listEntries({ list: 'Feest' })).ok).toBe(false);

    const offered = await ops.restoreList({});
    expect(offered.ok).toBe(true);
    expect(offered.quickReplies.map((q) => q.slash)).toEqual(['/list-restore Feest']);
    expect(offered.message).toContain('Feest');
    // who removed it is kept with it (never shown by id: a name follows the household's names setting)
    expect((await store.listByType('removed-list'))[0].removedBy).toBe('telegram:7');

    const back = await ops.restoreList({ list: 'Feest' });
    expect(back.ok, JSON.stringify(back)).toBe(true);
    expect((await names(ops)).sort()).toEqual(['Boodschappen', 'Feest']);
    expect((await lines(ops, 'Feest')).sort()).toEqual(['slingers', 'taart']);
    expect((await ops.restoreList({})).quickReplies ?? []).toEqual([]);
  });

  it('after 30 days a removed list is gone for good', async () => {
    const { ops, clock } = world();
    await ops.createList({ text: 'Feest' });
    await ops.addToList({ list: 'Feest', text: 'slingers' });
    await ops.removeList({ list: 'Feest' });
    clock.now += 29 * DAY;
    expect(((await ops.restoreList({})).quickReplies ?? []).length).toBe(1);
    clock.now += 2 * DAY;
    expect((await ops.restoreList({})).quickReplies ?? []).toEqual([]);
    expect((await ops.restoreList({ list: 'Feest' })).ok).toBe(false);
  });

  it('removing and restoring a list are everyone\'s on the bot (an observer only reads)', () => {
    expect(botOpLevel('removeList')).toBe('authenticated');
    expect(botOpLevel('restoreList')).toBe('authenticated');
    expect(BOT_OP_MAP.observer).not.toContain('removeList');
  });
});

const nodes = [];
afterAll(() => teardown(nodes));
describe('through a real agent\'s waist', () => {
  it('remove, then /list-restore puts the list and its line back', async () => {
    const node = await bootRealAgentNode('lists-restore');
    nodes.push(node);
    const call = (a, o, x) => node.agent.callSkill(a, o, x);
    await call('lists', 'createList', { text: 'Feest' });
    await call('lists', 'addToList', { list: 'Feest', text: 'slingers' });
    expect((await call('lists', 'removeList', { list: 'Feest' })).ok).toBe(true);
    expect(((await call('lists', 'listLists', {})).items ?? []).map((i) => i.label ?? i.text)).not.toContain('Feest');
    const back = await call('lists', 'restoreList', { list: 'Feest' });
    expect(back.ok, JSON.stringify(back)).toBe(true);
    expect(((await call('lists', 'listEntries', { list: 'Feest' })).items ?? []).map((i) => i.label ?? i.text)).toEqual(['slingers']);
  }, 60_000);
});
