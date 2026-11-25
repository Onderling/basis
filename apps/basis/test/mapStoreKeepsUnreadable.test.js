/**
 * A STORE THIS BUILD CANNOT READ IS NEVER SAVED OVER — on every persist adapter a shell reaches.
 *
 * The adapters (file on the box, IndexedDB on the web, AsyncStorage on the phone; one copy each for the household,
 * pinboard and task stores) read anything they could not parse as an empty Map, and the next save wrote that empty
 * Map over the stored bytes: a person's lists gone because a newer build wrote a shape this one does not know, or a
 * write was torn. Here each adapter is handed a snapshot written by "a newer build" (an unknown `v`) and a torn one,
 * then asked to save: the stored bytes must be exactly what they were. And today's unstamped format still reads, and
 * is stamped at the next save.
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildHouseholdDataSource } from '../src/household/persist.js';
import { FilePersist as PinboardFile } from '../../pinboard/src/lib/FilePersist.js';
import { IndexedDBPersist as PinboardIdb } from '../../pinboard/src/lib/IndexedDBPersist.js';
import { AsyncStoragePersist as PinboardAsync } from '../../pinboard/src/lib/AsyncStoragePersist.js';
import { FilePersist as TasksFile } from '../../tasks-v0/src/storage/persist/FilePersist.js';
import { IndexedDBPersist as TasksIdb } from '../../tasks-v0/src/storage/persist/IndexedDBPersist.js';
import { AsyncStoragePersist as TasksAsync } from '../../tasks-v0/src/storage/persist/AsyncStoragePersist.js';

const NEWER = JSON.stringify({ v: 99, data: { 'mem://x/items/a': '{"title":"from a newer build"}' } });
const TORN = '{"mem://x/items/a": "{\\"title\\":\\"half';
const TODAY = JSON.stringify({ 'mem://x/items/a': '{"title":"brood"}' });

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
let n = 0;

function idbPut(dbName, storeName, value) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore(storeName);
    req.onerror = (e) => reject(e.target.error);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value, 'state');
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = (ev) => reject(ev.target.error);
    };
  });
}
function idbGet(dbName, storeName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onerror = (e) => reject(e.target.error);
    req.onsuccess = (e) => {
      const db = e.target.result;
      const g = db.transaction(storeName, 'readonly').objectStore(storeName).get('state');
      g.onsuccess = () => { db.close(); resolve(g.result); };
      g.onerror = (ev) => reject(ev.target.error);
    };
  });
}
function memoryAsyncStorage() {
  const m = new Map();
  return { m, async getItem(k) { return m.has(k) ? m.get(k) : null; }, async setItem(k, v) { m.set(k, String(v)); }, async removeItem(k) { m.delete(k); } };
}

/** Each adapter as: put raw text where it reads, make it, read the raw text back. */
const ADAPTERS = {
  'pinboard file': () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'k1-')); dirs.push(dir); const p = path.join(dir, 's.json');
    return { put: async (raw) => writeFileSync(p, raw), make: () => new PinboardFile({ path: p, saveDelayMs: 5 }), get: async () => readFileSync(p, 'utf-8') };
  },
  'tasks file': () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'k1-')); dirs.push(dir); const p = path.join(dir, 's.json');
    return { put: async (raw) => writeFileSync(p, raw), make: () => new TasksFile({ path: p, saveDelayMs: 5 }), get: async () => readFileSync(p, 'utf-8') };
  },
  'pinboard idb': () => {
    const db = `k1-pin-${++n}`;
    return { put: (raw) => idbPut(db, 'snapshots', raw), make: () => new PinboardIdb({ dbName: db, saveDelayMs: 5 }), get: () => idbGet(db, 'snapshots') };
  },
  'tasks idb': () => {
    const db = `k1-tasks-${++n}`;
    return { put: (raw) => idbPut(db, 'snapshots', raw), make: () => new TasksIdb({ dbName: db, saveDelayMs: 5 }), get: () => idbGet(db, 'snapshots') };
  },
  'pinboard async': () => {
    const s = memoryAsyncStorage(); const key = 'pinboard-cache:d::state';
    return { put: async (raw) => s.m.set(key, raw), make: () => new PinboardAsync({ dbName: 'd', asyncStorage: s, saveDelayMs: 5 }), get: async () => s.m.get(key) };
  },
  'tasks async': () => {
    const s = memoryAsyncStorage(); const key = 'tasks-cache:d::state';
    return { put: async (raw) => s.m.set(key, raw), make: () => new TasksAsync({ dbName: 'd', asyncStorage: s, saveDelayMs: 5 }), get: async () => s.m.get(key) };
  },
};

/** The household adapters are reached through the data source the shells build (they are not exported). */
const HOUSEHOLD = {
  'household file': () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'k1-')); dirs.push(dir); const p = path.join(dir, 'household-items.json');
    return { put: async (raw) => writeFileSync(p, raw), args: { path: p, saveDelayMs: 5 }, get: async () => readFileSync(p, 'utf-8') };
  },
  'household idb': () => {
    const db = `k1-hh-${++n}`;
    return { put: (raw) => idbPut(db, 'snapshots', raw), args: { dbName: db, saveDelayMs: 5 }, get: () => idbGet(db, 'snapshots') };
  },
  'household async': () => {
    const s = memoryAsyncStorage(); const key = 'household-cache:d::state';
    return { put: async (raw) => s.m.set(key, raw), args: { dbName: 'd', asyncStorage: s, saveDelayMs: 5 }, get: async () => s.m.get(key) };
  },
};

describe('a map store never saves over what it could not read', () => {
  for (const [name, mk] of Object.entries(ADAPTERS)) {
    for (const [what, raw] of [['a newer build\'s snapshot', NEWER], ['a torn snapshot', TORN]]) {
      it(`${name}: ${what} is kept byte for byte through a save`, async () => {
        const a = mk(); await a.put(raw);
        const p = a.make();
        expect(await p.load()).toEqual(new Map());
        await p.save(new Map([['mem://x/items/b', '{"title":"new"}']]));
        await p.flush(new Map());
        expect(await a.get()).toBe(raw);
        p.close?.();
      });
    }
    it(`${name}: today's unstamped snapshot reads, and the next save stamps it`, async () => {
      const a = mk(); await a.put(TODAY);
      const p = a.make();
      const m = await p.load();
      expect(m.get('mem://x/items/a')).toBe('{"title":"brood"}');
      await p.save(m);
      expect(JSON.parse(await a.get())).toEqual({ v: 1, data: { 'mem://x/items/a': '{"title":"brood"}' } });
      p.close?.();
    });
  }

  for (const [name, mk] of Object.entries(HOUSEHOLD)) {
    it(`${name}: a newer build's snapshot is kept through a write and a flush`, async () => {
      const a = mk(); await a.put(NEWER);
      const ds = await buildHouseholdDataSource(a.args);
      await ds.write('mem://x/items/b', '{"title":"new"}');
      await new Promise((r) => setTimeout(r, 40));
      expect(await a.get()).toBe(NEWER);
    });
    it(`${name}: today's unstamped snapshot reads, and the next write stamps it`, async () => {
      const a = mk(); await a.put(TODAY);
      const ds = await buildHouseholdDataSource(a.args);
      expect(await ds.read('mem://x/items/a')).toContain('brood');
      await ds.write('mem://x/items/b', '{"title":"new"}');
      await new Promise((r) => setTimeout(r, 40));
      expect(JSON.parse(await a.get()).v).toBe(1);
    });
  }
});
