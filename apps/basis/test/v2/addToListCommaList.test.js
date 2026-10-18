/**
 * A COMMA LIST IS SEVERAL LINES, whoever adds it. The gate already split "A, B en C" into one add each; the model calls
 * `addToList` once with the whole text, and the household's log shows it stored "balkondeur isoleren, gangdeur
 * isoleren" as ONE chore — and the person's "dat zijn er twee" then failed to remove the joined text. The op itself now
 * reads a comma list as its lines (the same rule the gate uses), so every route agrees.
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeListsOps } from '../../src/v2/listsOps.js';
import { replyLine } from '../../src/v2/replyLine.js';

function listsWorld() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  return makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1' });
}
const texts = async (ops, list) => ((await ops.listEntries({ list }))?.items ?? []).map((i) => i.text ?? i.label).sort();

describe('a comma list added in one call', () => {
  it('becomes one line per item — on a chores list and a shopping list alike', async () => {
    const ops = listsWorld();
    await ops.createList({ text: 'Klusjes', defaultChild: 'task' });
    await ops.createList({ text: 'Boodschappen' });
    const r = await ops.addToList({ list: 'Klusjes', text: 'balkondeur isoleren, gangdeur isoleren' });
    expect(r).toMatchObject({ ok: true, entries: ['balkondeur isoleren', 'gangdeur isoleren'], list: 'Klusjes' });
    expect(await texts(ops, 'Klusjes')).toEqual(['balkondeur isoleren', 'gangdeur isoleren']);
    await ops.addToList({ list: 'Boodschappen', text: 'melk, brood en eieren' });
    expect(await texts(ops, 'Boodschappen')).toEqual(['brood', 'eieren', 'melk']);
  });
  it('one item stays one (no comma: "brood en eieren" is the person\'s pair)', async () => {
    const ops = listsWorld();
    await ops.createList({ text: 'Boodschappen' });
    await ops.addToList({ list: 'Boodschappen', text: 'brood en eieren' });
    expect(await texts(ops, 'Boodschappen')).toEqual(['brood en eieren']);
  });
  it('the reply names every line added, in one line', async () => {
    const ops = listsWorld();
    await ops.createList({ text: 'Klusjes', defaultChild: 'task' });
    const r = await ops.addToList({ list: 'Klusjes', text: 'A, B' });
    const t = (k, v) => `${k} ${JSON.stringify(v ?? {})}`;
    expect(replyLine(r, { opId: 'addToList', t })).toMatch(/added_many/);
  });
});
