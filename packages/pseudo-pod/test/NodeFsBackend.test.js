/**
 * NodeFsBackend — persistent Node fs StorageBackend (Phase B OQ-2).
 *
 * Covers the StorageBackend contract (parity with MemoryBackend) PLUS
 * the reason it exists: state — and especially the cache-mode
 * write-through queue — survives a process restart.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createNodeFsBackend }  from '../src/NodeFsBackend.js';
import { createPseudoPod }      from '../src/PseudoPod.js';

let dir;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'pp-nodefs-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('NodeFsBackend — contract (MemoryBackend parity)', () => {
  it('requires a dir', () => {
    expect(() => createNodeFsBackend({})).toThrow(/dir/);
  });

  it('round-trips a record, assigns etag + _v=1 on first put', async () => {
    const b = createNodeFsBackend({ dir });
    const { etag, _v } = await b.put('a', { x: 1 });
    expect(typeof etag).toBe('string');
    expect(_v).toBe(1);
    expect(await b.get('a')).toEqual({ bytes: { x: 1 }, etag, _v: 1 });
    expect(await b.get('missing')).toBeNull();
  });

  it('increments _v on re-put, pins _v when supplied, preserves caller etag', async () => {
    const b = createNodeFsBackend({ dir });
    await b.put('k', 'v1');
    const second = await b.put('k', 'v2');
    expect(second._v).toBe(2);
    const pinned = await b.put('k', 'v3', '"caller-etag"', 9);
    expect(pinned).toEqual({ etag: '"caller-etag"', _v: 9 });
    expect(await b.get('k')).toEqual({ bytes: 'v3', etag: '"caller-etag"', _v: 9 });
  });

  it('delete removes the record (ENOENT-safe) + fires subscribers', async () => {
    const b = createNodeFsBackend({ dir });
    const events = [];
    b.subscribe('', (e) => events.push(e));
    await b.put('d', 'x');
    await b.delete('d');
    await b.delete('d');                       // already gone — no throw
    expect(await b.get('d')).toBeNull();
    expect(events.map((e) => e.op)).toEqual(['put', 'delete']);
  });

  it('list returns keys-with-prefix, sorted; empty/missing dir → []', async () => {
    const b = createNodeFsBackend({ dir });
    expect(await b.list('x/')).toEqual([]);
    await b.put('x/b', 1);
    await b.put('x/a', 2);
    await b.put('y/c', 3);
    expect(await b.list('x/')).toEqual(['x/a', 'x/b']);
  });

  it('round-trips binary — top-level and nested in an object', async () => {
    const b = createNodeFsBackend({ dir });
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
    const b = createNodeFsBackend({ dir });
    const hits = [];
    const off = b.subscribe('p/', (e) => hits.push(e.key));
    await b.put('p/1', 'a');
    await b.put('other', 'b');
    off();
    await b.put('p/2', 'c');
    expect(hits).toEqual(['p/1']);
  });
});

describe('NodeFsBackend — persistence across restart', () => {
  it('a fresh backend over the same dir sees prior data + _v', async () => {
    const a = createNodeFsBackend({ dir });
    await a.put('https://pod.example/notes/x.md', 'hello', undefined, undefined);
    await a.put('https://pod.example/notes/x.md', 'hello v2'); // _v → 2

    const b = createNodeFsBackend({ dir });                    // "restart"
    const rec = await b.get('https://pod.example/notes/x.md');
    expect(rec.bytes).toBe('hello v2');
    expect(rec._v).toBe(2);
    expect(await b.list('https://pod.example/notes/')).toEqual([
      'https://pod.example/notes/x.md',
    ]);
  });
});

describe('NodeFsBackend — OQ-2 acceptance: cache-mode queue survives restart', () => {
  it('offline write queued → restart → drain reaches the pod', async () => {
    const ROOT = 'https://pod.example/notes/';
    const podStore = new Map();
    let reachable = false;                       // start offline
    const podUploader = async (uri, bytes) => {
      if (!reachable) throw new Error('pod unreachable');
      podStore.set(uri, bytes);
      return { etag: '"pod-1"' };
    };
    const podFetcher = async (uri) =>
      podStore.has(uri) ? { bytes: podStore.get(uri) } : null;

    // Session 1: pod unreachable → the write parks in the queue.
    const backend1 = createNodeFsBackend({ dir });
    const pp1 = createPseudoPod({
      backend: backend1, mode: 'cache', deviceId: 'dev',
      podUploader, podFetcher, isPodReachable: () => reachable,
    });
    const res = await pp1.write(`${ROOT}offline.md`, new TextEncoder().encode('survive-me'));
    expect(res.queued).toBe(true);
    expect(await pp1.writeThroughPendingCount()).toBe(1);

    // Process dies. New backend instance over the SAME dir + a fresh
    // pseudo-pod (simulating a daemon restart).
    const backend2 = createNodeFsBackend({ dir });
    const pp2 = createPseudoPod({
      backend: backend2, mode: 'cache', deviceId: 'dev',
      podUploader, podFetcher, isPodReachable: () => reachable,
    });
    // The queued write was persisted by NodeFsBackend → still pending.
    expect(await pp2.writeThroughPendingCount()).toBe(1);

    // Reconnect + drain → it finally reaches the real pod.
    reachable = true;
    const { drained } = await pp2.drainWriteThroughQueue();
    expect(drained).toBe(1);
    expect(new TextDecoder().decode(podStore.get(`${ROOT}offline.md`))).toBe('survive-me');
    expect(await pp2.writeThroughPendingCount()).toBe(0);
  });
});

describe('NodeFsBackend — compare-and-swap across processes on one directory', () => {
  it('two backends over one dir, eight writers from the same read: exactly one wins, no lock left behind', async () => {
    const a = createNodeFsBackend({ dir });
    const b = createNodeFsBackend({ dir });
    const { etag: base } = await a.put('reg', { n: 0 });
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? a : b).putIf('reg', { n: i + 1 }, base)));
    expect(results.filter((r) => !r?.conflict)).toHaveLength(1);
    const { readdir } = await import('node:fs/promises');
    expect((await readdir(dir)).filter((f) => f.endsWith('.lock'))).toEqual([]);
  });
});
