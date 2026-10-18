/**
 * THE ONE-SHOT MOVE OF THE RENAMED PINBOARD STORE, per store kind (a file on the box, AsyncStorage on the phone,
 * IndexedDB in the browser): the old store's content becomes the new store's ONLY when the new one is empty and the old
 * one holds something; a filled new store is never overwritten; the old store is removed either way; a store that was
 * never renamed is left alone.
 */
import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pickPersist } from '../../pinboard/src/lib/persistPicker.js';
import { renamedFrom } from '../../pinboard/src/lib/moveRenamedStore.js';

const OLD = ['st', 'oop'].join('');
const asMap = (o) => new Map(Object.entries(o));

describe('the file store (the box)', () => {
  it('old filled, new absent → the new one holds the old content, the old file is gone', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'move-'));
    writeFileSync(path.join(dir, `${OLD}-items.json`), JSON.stringify({ 'mem://neighbourhood/items/a': { text: 'ladder' } }));
    const { persist } = await pickPersist({ path: path.join(dir, 'pinboard-items.json') });
    expect([...(await persist.load()).keys()]).toEqual(['mem://neighbourhood/items/a']);
    expect(existsSync(path.join(dir, `${OLD}-items.json`)), 'the old store is removed').toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it('a FILLED new store is never overwritten by the old copy (a device that already ran the new build)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'move-'));
    writeFileSync(path.join(dir, `${OLD}-items.json`), JSON.stringify({ 'mem://neighbourhood/items/old': { text: 'old' } }));
    writeFileSync(path.join(dir, 'pinboard-items.json'), JSON.stringify({ 'mem://neighbourhood/items/new': { text: 'posted on the new build' } }));
    const { persist } = await pickPersist({ path: path.join(dir, 'pinboard-items.json') });
    expect([...(await persist.load()).keys()]).toEqual(['mem://neighbourhood/items/new']);
    expect(JSON.parse(readFileSync(path.join(dir, 'pinboard-items.json'), 'utf8'))).toEqual({ 'mem://neighbourhood/items/new': { text: 'posted on the new build' } });
    expect(existsSync(path.join(dir, `${OLD}-items.json`)), 'the stale old store is removed too').toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
  it('no old store: nothing happens', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'move-'));
    const { persist } = await pickPersist({ path: path.join(dir, 'pinboard-items.json') });
    expect((await persist.load()).size).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the AsyncStorage store (the phone)', () => {
  const storage = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, removeItem: async (k) => { m.delete(k); } }; };
  it('old key filled, new empty → moved under the new key, the old key removed', async () => {
    const oldKey = `${OLD}-cache:cc-${OLD}-cache::state`;
    const s = storage({ [oldKey]: JSON.stringify({ 'mem://neighbourhood/members/x': { handle: 'bob' } }) });
    const { persist } = await pickPersist({ dbName: 'cc-pinboard-cache', asyncStorage: s });
    expect([...(await persist.load()).keys()]).toEqual(['mem://neighbourhood/members/x']);
    expect(s.m.has(oldKey), 'the old key is gone').toBe(false);
    expect(s.m.has('pinboard-cache:cc-pinboard-cache::state')).toBe(true);
  });
  it('a filled new key is never overwritten', async () => {
    const oldKey = `${OLD}-cache:cc-${OLD}-cache::state`;
    const s = storage({ [oldKey]: JSON.stringify({ old: 1 }), 'pinboard-cache:cc-pinboard-cache::state': JSON.stringify({ new: 1 }) });
    const { persist } = await pickPersist({ dbName: 'cc-pinboard-cache', asyncStorage: s });
    expect([...(await persist.load()).keys()]).toEqual(['new']);
    expect(s.m.has(oldKey)).toBe(false);
  });
});

describe('the IndexedDB store (the browser)', () => {
  it('old database filled, new empty → moved, the old database deleted', async () => {
    const seed = await pickPersist({ dbName: `cc-${OLD}-state`, storeName: 'items' });   // the build before's store
    await seed.persist.flush(asMap({ 'mem://neighbourhood/groups/g': { name: 'Buurt' } }));
    seed.persist.close?.();
    const { persist } = await pickPersist({ dbName: 'cc-pinboard-state', storeName: 'items' });
    expect([...(await persist.load()).keys()]).toEqual(['mem://neighbourhood/groups/g']);
    const dbs = (await globalThis.indexedDB.databases?.()) ?? [];
    expect(dbs.map((d) => d.name), 'the old database is deleted').not.toContain(`cc-${OLD}-state`);
  });
});

describe('which stores were renamed', () => {
  it('a store whose name never held the app name is left alone', () => {
    expect(renamedFrom({ dbName: 'cc-household-state' })).toBe(null);
    expect(renamedFrom({ path: '/data/tasks.json' })).toBe(null);
    expect(renamedFrom({ path: '/data/pinboard-items.json' })).toEqual({ path: `/data/${OLD}-items.json` });
  });
});

describe('an enrol\'s forget names the old-name twins too', () => {
  it('the former self\'s store under the old name is dropped, so the move cannot bring it back', async () => {
    const { forgetThrowawaySelf } = await import('../src/v2/enrolForgets.js');
    const dropped = [];
    await forgetThrowawaySelf({ listCircleIds: async () => [], dropStore: async (n) => { dropped.push(n); }, dropKey: async () => {} });
    expect(dropped).toContain('cc-pinboard-state');
    expect(dropped).toContain(`cc-${OLD}-state`);
    expect(dropped).toContain(`cc-${OLD}-cache`);
  });
});

describe('an unreadable store is never taken for an empty one', () => {
  for (const kind of ['file', 'async', 'idb']) {
    it(`${kind}: the OLD store cannot be read → nothing removed, nothing written, tried again next boot`, async () => {
      const { moveRenamedStoreOnce } = await import('../../pinboard/src/lib/moveRenamedStore.js');
      const dir = mkdtempSync(path.join(tmpdir(), 'move-'));
      const oldFile = path.join(dir, `${OLD}-items.json`);
      writeFileSync(oldFile, '{"k":1}');
      const flushed = [];
      const args = kind === 'file' ? { path: path.join(dir, 'pinboard-items.json') } : kind === 'async' ? { dbName: 'cc-pinboard-cache', asyncStorage: { removeItem: async () => { flushed.push('REMOVED'); } } } : { dbName: 'cc-pinboard-state' };
      const r = await moveRenamedStoreOnce({
        args, kind,
        persist: { load: async () => new Map(), flush: async (m) => { flushed.push(m); } },
        openLegacy: async () => ({ persist: { load: async () => { throw new Error('locked'); } } }),
      });
      expect(r).toEqual({ moved: 0, reason: 'unreadable' });
      expect(flushed, 'nothing written, nothing removed').toEqual([]);
      if (kind === 'file') expect(existsSync(oldFile), 'the old store is still there').toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });
    it(`${kind}: the NEW store cannot be read → the old copy is not flushed over it, the old store kept`, async () => {
      const { moveRenamedStoreOnce } = await import('../../pinboard/src/lib/moveRenamedStore.js');
      const dir = mkdtempSync(path.join(tmpdir(), 'move-'));
      const oldFile = path.join(dir, `${OLD}-items.json`);
      writeFileSync(oldFile, '{"k":1}');
      const flushed = [];
      const args = kind === 'file' ? { path: path.join(dir, 'pinboard-items.json') } : kind === 'async' ? { dbName: 'cc-pinboard-cache', asyncStorage: { removeItem: async () => { flushed.push('REMOVED'); } } } : { dbName: 'cc-pinboard-state' };
      const r = await moveRenamedStoreOnce({
        args, kind,
        persist: { load: async () => { throw new Error('transient'); }, flush: async (m) => { flushed.push(m); } },
        openLegacy: async () => ({ persist: { load: async () => new Map([['k', 1]]) } }),
      });
      expect(r).toEqual({ moved: 0, reason: 'unreadable' });
      expect(flushed).toEqual([]);
      if (kind === 'file') expect(existsSync(oldFile)).toBe(true);
      rmSync(dir, { recursive: true, force: true });
    });
  }
});

describe('the real adapters read strictly for the move', () => {
  it('a corrupt old file is not an empty one: it stays, and the new store is not written', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'move-'));
    writeFileSync(path.join(dir, `${OLD}-items.json`), '{ not json');
    const { persist } = await pickPersist({ path: path.join(dir, 'pinboard-items.json') });
    expect((await persist.load()).size).toBe(0);
    expect(existsSync(path.join(dir, `${OLD}-items.json`)), 'kept for the next boot to try').toBe(true);
    expect(existsSync(path.join(dir, 'pinboard-items.json'))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
