/**
 * A wrong entry can come off a list, and an entry's words can change.
 *
 * The lists had make · list · add · done, and no way to take "melkk" back off Boodschappen or fix it. The `list-item`
 * noun now carries `remove` and `update` (`removeFromList`, `editEntry`): the entry named by its id or its words,
 * within the list named. Through a real agent's lists ops.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, teardown } from './support/pairRealAgents.js';
import { listsManifest } from '../../lists/manifest.js';

const nodes = [];
afterAll(() => teardown(nodes));
const entries = async (call, list) => {
  const r = await call('lists', 'listEntries', { list });
  return (r?.items ?? []).map((i) => i.label ?? i.text);
};

describe('removing and editing a list entry', () => {
  it('the noun declares the verbs; an entry comes off by its words, and its words change', async () => {
    expect(listsManifest.nouns['list-item'].atoms).toEqual(expect.arrayContaining(['remove', 'update']));
    const node = await bootRealAgentNode('lists');
    nodes.push(node);
    const call = (a, o, x) => node.agent.callSkill(a, o, x);
    await call('lists', 'createList', { text: 'Boodschappen' });
    await call('lists', 'addToList', { list: 'Boodschappen', text: 'melkk' });
    await call('lists', 'addToList', { list: 'Boodschappen', text: 'brood' });
    const edit = await call('lists', 'editEntry', { list: 'Boodschappen', item: 'melkk', text: 'melk' });
    expect(edit.ok, JSON.stringify(edit)).toBe(true);
    expect(await entries(call, 'Boodschappen')).toEqual(expect.arrayContaining(['melk', 'brood']));
    const gone = await call('lists', 'removeFromList', { list: 'Boodschappen', item: 'brood' });
    expect(gone.ok, JSON.stringify(gone)).toBe(true);
    expect(await entries(call, 'Boodschappen')).toEqual(['melk']);
    const none = await call('lists', 'removeFromList', { list: 'Boodschappen', item: 'kaas' });
    expect(none.ok).toBe(false);
  }, 90_000);

  it('an entry op takes the entry — the list only to tell two apart ("verander melk in halfvolle melk")', async () => {
    const node = await bootRealAgentNode('lists-any');
    nodes.push(node);
    const call = (a, o, x) => node.agent.callSkill(a, o, x);
    await call('lists', 'createList', { text: 'Boodschappen' });
    await call('lists', 'createList', { text: 'Reparaties' });
    await call('lists', 'addToList', { list: 'Boodschappen', text: 'melk' });
    await call('lists', 'addToList', { list: 'Boodschappen', text: 'brood' });
    await call('lists', 'addToList', { list: 'Reparaties', text: 'kraan' });
    // no list named: the entry is found on whichever list holds it
    const edit = await call('lists', 'editEntry', { item: 'melk', text: 'halfvolle melk' });
    expect(edit.ok, JSON.stringify(edit)).toBe(true);
    expect(await entries(call, 'Boodschappen')).toEqual(expect.arrayContaining(['halfvolle melk', 'brood']));
    const tick = await call('lists', 'markListItemDone', { item: 'brood' });
    expect(tick.ok, JSON.stringify(tick)).toBe(true);
    const gone = await call('lists', 'removeFromList', { item: 'kraan' });
    expect(gone.ok, JSON.stringify(gone)).toBe(true);
    expect(await entries(call, 'Reparaties')).toEqual([]);
    // the manifest says so: `item` is required, `list` is not
    for (const id of ['editEntry', 'removeFromList', 'markListItemDone']) {
      const op = listsManifest.operations.find((o) => o.id === id);
      expect(op.params.find((p) => p.name === 'item')?.required, id).toBe(true);
      expect(Boolean(op.params.find((p) => p.name === 'list')?.required), id).toBe(false);
    }
  }, 90_000);
});
