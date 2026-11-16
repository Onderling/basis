/**
 * THE OWN STORE AS ONE SELF FAILS CLOSED. Each store method the lists ops call (delete, get, list, listByType, put),
 * through the view as the general self, against a row made as Werk: a read does not see it, a write is refused. Any
 * other store method throws, so a read added to the lists ops later cannot reach another self's rows unseen.
 */
import { describe, it, expect } from 'vitest';
import { memoryDataSource } from '@onderling/item-store';
import { createOwnDevicesStore } from '../../src/v2/ownDevicesStore.js';
import { ownStoreAsSelf, OWN_VIEW_METHODS } from '../../src/v2/ownStoreAsSelf.js';

const WERK = 'werk-key';
const selfOf = (row) => (row?.createdBy === WERK ? 'werk' : 'default');

async function setUp() {
  const store = createOwnDevicesStore({ dataSource: memoryDataSource() });
  const werkList = await store.put({ type: 'list', text: 'Projecten' }, { by: WERK });
  const mineList = await store.put({ type: 'list', text: 'Boodschappen' }, { by: 'me' });
  const view = ownStoreAsSelf(store, (row) => selfOf(row) === 'default');
  return { store, view, werkId: werkList.id, mineId: mineList.id };
}

describe('the own store as the general self, against a row made as Werk', () => {
  it('reads: get, list and listByType do not see it; they see the general self\'s', async () => {
    const { view, werkId, mineId } = await setUp();
    expect(await view.get(werkId)).toBeNull();
    expect((await view.get(mineId))?.text).toBe('Boodschappen');
    expect((await view.list()).map((r) => r.text)).toEqual(['Boodschappen']);
    expect((await view.listByType('list')).map((r) => r.text)).toEqual(['Boodschappen']);
  });

  it('writes: put and delete on it are refused, and it is unchanged', async () => {
    const { store, view, werkId } = await setUp();
    const row = await store.get(werkId);
    await expect(view.put({ ...row, text: 'overschreven' }, { by: 'me' })).rejects.toMatchObject({ code: 'not-this-self' });
    await expect(view.delete(werkId)).rejects.toMatchObject({ code: 'not-this-self' });
    expect((await store.get(werkId))?.text).toBe('Projecten');
  });

  it('a new row and the general self\'s own rows are written as before', async () => {
    const { store, view, mineId } = await setUp();
    const made = await view.put({ type: 'list', text: 'Vakantie' }, { by: 'me' });
    expect((await store.get(made.id))?.text).toBe('Vakantie');
    await view.delete(mineId);
    expect(await store.get(mineId)).toBeNull();
  });

  it('any store method outside the five throws, by name', async () => {
    const { view } = await setUp();
    expect(OWN_VIEW_METHODS).toEqual(['get', 'list', 'listByType', 'put', 'delete']);
    for (const m of ['putIfMatch', 'setSyncHook']) {
      expect(() => view[m]({}), m).toThrow(expect.objectContaining({ code: 'unlisted-method' }));
    }
  });

  it('a data property of the store reads as nothing through the view (a field that may hold rows does not leak)', async () => {
    const { store, view } = await setUp();
    store.rowsCache = new Map([['x', { createdBy: WERK }]]);
    expect(view.rowsCache).toBeUndefined();
    expect(view.then, 'not a thenable').toBeUndefined();
    expect(view[Symbol.iterator]).toBeUndefined();
  });
});
