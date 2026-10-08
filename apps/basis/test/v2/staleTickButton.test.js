/**
 * A tick button on an OLDER list message names its line by id. When someone else ticked that line first (or it was
 * taken off), the tap must say so in words — never answer with the id ("\"01M4…\" staat op geen lijst", seen in a
 * household's chat, 2026-10-08).
 */
import { describe, it, expect } from 'vitest';
import { createCircleStores, memoryDataSource } from '@onderling/item-store';
import { createRegistry, registerCanonicalTypes } from '@onderling/item-types';
import { makeListsOps } from '../../src/v2/listsOps.js';

function listsWorld() {
  const registry = createRegistry();
  registerCanonicalTypes(registry);
  const stores = createCircleStores({ dataSource: memoryDataSource(), registry });
  const t = (k, v) => (v ? `${k} ${JSON.stringify(v)}` : k);
  return makeListsOps({ storeFor: (cid) => stores.getStore(cid), t, activeCircle: () => 'c1' });
}

async function oneEntry(ops) {
  await ops.createList({ text: 'Boodschappen' });
  await ops.addToList({ list: 'Boodschappen', text: 'yoghurt' });
  const read = await ops.listEntries({ list: 'Boodschappen' });
  return read.items[0].id;
}

describe('a tap on a line someone else already ticked', () => {
  it('says the line is already ticked, by its words — not its id', async () => {
    const ops = listsWorld();
    const id = await oneEntry(ops);
    expect(await ops.markListItemDone({ item: id })).toMatchObject({ ok: true });
    const again = await ops.markListItemDone({ item: id });   // the second person's stale button
    const said = again.message ?? again.error ?? '';
    expect(said).not.toContain(id);
    expect(said).toContain('circle.lists.already_done');
    expect(said).toContain('yoghurt');
  });

  it('a line that was taken off says so without its id', async () => {
    const ops = listsWorld();
    const id = await oneEntry(ops);
    await ops.removeFromList?.({ item: id });
    const gone = await ops.markListItemDone({ item: id });
    expect(gone.ok).toBe(false);
    expect(gone.error).not.toContain(id);
  });

  it('words that name nothing still answer with the words the person typed', async () => {
    const ops = listsWorld();
    await oneEntry(ops);
    const none = await ops.markListItemDone({ item: 'kaas' });
    expect(none.error).toContain('circle.lists.not_there');
    expect(none.error).toContain('kaas');
  });
});
