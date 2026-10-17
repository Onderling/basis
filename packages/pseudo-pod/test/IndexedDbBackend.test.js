/**
 * IndexedDbBackend — persistent browser IndexedDB StorageBackend.
 *
 * Covers the StorageBackend contract (parity with MemoryBackend /
 * NodeFsBackend) PLUS the reason it exists: circle data — RAG vectors +
 * circle items, and the cache-mode write-through queue — SURVIVES A
 * PAGE RELOAD (a fresh backend over the same dbName reads prior writes).
 *
 * Uses `fake-indexeddb/auto` to run a real IndexedDB shape in the Node
 * test env (same approach as apps/stoop's IndexedDBPersist tests).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';

import { createIndexedDbBackend } from '../src/IndexedDbBackend.js';

let counter = 0;
function freshDbName() { return `pp-idb-test-${++counter}-${Date.now()}`; }

let dbName;
beforeEach(() => { dbName = freshDbName(); });

describe('IndexedDbBackend — construction', () => {
  it('throws when indexedDB is unavailable', () => {
    expect(() => createIndexedDbBackend({ indexedDB: null }))
      .toThrow(/indexedDB/);
  });

  it('constructs cleanly with defaults', () => {
    expect(() => createIndexedDbBackend()).not.toThrow();
  });
});

describe('IndexedDbBackend — contract (MemoryBackend parity)', () => {
  it('round-trips a record, assigns etag + _v=1 on first put', async () => {
    const b = createIndexedDbBackend({ dbName });
    const { etag, _v } = await b.put('a', { x: 1 });
    expect(typeof etag).toBe('string');
    expect(_v).toBe(1);
    expect(await b.get('a')).toEqual({ bytes: { x: 1 }, etag, _v: 1 });
    expect(await b.get('missing')).toBeNull();
  });

  it('increments _v on re-put, pins _v when supplied, preserves caller etag', async () => {
    const b = createIndexedDbBackend({ dbName });
    await b.put('k', 'v1');
    const second = await b.put('k', 'v2');
    expect(second._v).toBe(2);
    const pinned = await b.put('k', 'v3', '"caller-etag"', 9);
    expect(pinned).toEqual({ etag: '"caller-etag"', _v: 9 });
    expect(await b.get('k')).toEqual({ bytes: 'v3', etag: '"caller-etag"', _v: 9 });
  });

  it('delete removes the record (absent-safe) + fires subscribers', async () => {
    const b = createIndexedDbBackend({ dbName });
    const events = [];
    b.subscribe('', (e) => events.push(e));
    await b.put('d', 'x');
    await b.delete('d');
    await b.delete('d');                       // already gone — no throw, no event
    expect(await b.get('d')).toBeNull();
    expect(events.map((e) => e.op)).toEqual(['put', 'delete']);
  });

  it('list returns keys-with-prefix, sorted; empty store → []', async () => {
    const b = createIndexedDbBackend({ dbName });
    expect(await b.list('x/')).toEqual([]);
    await b.put('x/b', 1);
    await b.put('x/a', 2);
    await b.put('y/c', 3);
    expect(await b.list('x/')).toEqual(['x/a', 'x/b']);
  });

  it('round-trips binary — top-level and nested in an object', async () => {
    const b = createIndexedDbBackend({ dbName });
    const u8 = new TextEncoder().encode('binary-payload');
    await b.put('top', u8);
    const top = await b.get('top');
    expect(top.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(top.bytes)).toBe('binary-payload');

    // The exact shape the write-through queue stores.
    const entry = { id: 'q1', uri: 'https://pod/a.md', bytes: u8, etag: '"e1"', queuedAt: 'now', seq: 1 };
    await b.put('__write-through__/q1', entry);
    const got = await b.get('__write-through__/q1');
    expect(got.bytes.uri).toBe('https://pod/a.md');
    expect(got.bytes.bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(got.bytes.bytes)).toBe('binary-payload');
  });

  it('prefix subscribers only fire for matching keys; unsubscribe stops them', async () => {
    const b = createIndexedDbBackend({ dbName });
    const hits = [];
    const off = b.subscribe('p/', (e) => hits.push(e.key));
    await b.put('p/1', 'a');
    await b.put('other', 'b');
    off();
    await b.put('p/2', 'c');
    expect(hits).toEqual(['p/1']);
  });

  it('in-process dirty-set: mark/list/clean + delete clears the flag', async () => {
    const b = createIndexedDbBackend({ dbName });
    const dirtyEvents = [];
    b.subscribeDirty((e) => dirtyEvents.push(e.op));
    b._markDirty('q');
    b._markDirty('q');                          // idempotent — no second event
    expect(await b.listDirty()).toEqual(['q']);
    await b.put('q', 'x');
    await b.delete('q');                        // delete clears the flag
    expect(await b.listDirty()).toEqual([]);
    expect(dirtyEvents).toEqual(['dirty', 'clean']);
  });
});

describe('IndexedDbBackend — persistence across reload (restart-survival)', () => {
  it('a FRESH backend over the same dbName sees prior data + _v', async () => {
    // Session 1 — write, then update so _v advances past 1.
    const a = createIndexedDbBackend({ dbName });
    await a.put('circle://acme/items/x', 'hello');
    await a.put('circle://acme/items/x', 'hello v2');   // _v → 2
    a.close();                                           // page unloads

    // Session 2 — a brand-new instance over the SAME dbName (page reload).
    const b = createIndexedDbBackend({ dbName });
    const rec = await b.get('circle://acme/items/x');
    expect(rec.bytes).toBe('hello v2');
    expect(rec._v).toBe(2);
    expect(await b.list('circle://acme/items/')).toEqual([
      'circle://acme/items/x',
    ]);
  });

  it('RAG-vector-shaped binary survives a reload byte-for-byte', async () => {
    const vec = new Float32Array([0.1, -0.2, 0.3, 0.4]);
    const bytes = new Uint8Array(vec.buffer.slice(0));

    const a = createIndexedDbBackend({ dbName });
    await a.put('circle://acme/vectors/v1', bytes);
    a.close();

    const b = createIndexedDbBackend({ dbName });       // reload
    const rec = await b.get('circle://acme/vectors/v1');
    expect(rec.bytes).toBeInstanceOf(Uint8Array);
    expect([...new Float32Array(rec.bytes.buffer)]).toEqual([...vec]);
  });
});

describe('IndexedDbBackend — compare-and-swap across tabs', () => {
  it('two backends on ONE database (two tabs), both writing from the same read: exactly one wins', async () => {
    const tabA = createIndexedDbBackend({ dbName });
    const tabB = createIndexedDbBackend({ dbName });
    const { etag: base } = await tabA.put('reg', { agents: [] });
    const [a, b] = await Promise.all([tabA.putIf('reg', { agents: ['A'] }, base), tabB.putIf('reg', { agents: ['B'] }, base)]);
    const wins = [a, b].filter((r) => !r?.conflict);
    expect(wins, JSON.stringify([a, b])).toHaveLength(1);
    expect((await tabA.get('reg')).etag, 'the winner minted a fresh etag').toBe(wins[0].etag);
    expect(wins[0].etag).not.toBe(base);
  });
  it('null if-match = only while absent', async () => {
    const b = createIndexedDbBackend({ dbName });
    expect(await b.putIf('k', 1, null)).toMatchObject({ _v: 1 });
    expect(await b.putIf('k', 2, null)).toEqual({ conflict: true });
  });
});
