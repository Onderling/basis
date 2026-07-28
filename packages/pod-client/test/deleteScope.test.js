import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs   from 'node:fs/promises';
import os   from 'node:os';
import path from 'node:path';

import {
  PodClient,
  MemoryTombstones,
  FileTombstones,
} from '../src/index.js';

// ── Inrupt mocks (unused here, but PodClient imports it lazily) ──────────────

vi.mock('@inrupt/solid-client', () => ({}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeStubAuth() {
  return {
    getAuthenticatedFetch: () => globalThis.fetch,
    identity: () => 'test-identity',
    close: vi.fn(),
  };
}

function makePodSource() {
  return {
    read:   vi.fn(),
    write:  vi.fn(),
    list:   vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  };
}

function podErr(code, message = 'mock error') {
  return Object.assign(new Error(message), { code });
}

function makeClient({ podSource, tombstoneStore } = {}) {
  return new PodClient({
    podRoot: 'https://alice.example/',
    auth:    makeStubAuth(),
    podSourceFactory: () => podSource,
    tombstoneStore,
  });
}

// ── deleteLocal ──────────────────────────────────────────────────────────────

describe('PodClient.deleteLocal', () => {
  it('records a tombstone and does NOT touch the pod', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    await client.deleteLocal('/notes/a.md');

    expect(ps.delete).not.toHaveBeenCalled();
    expect(await store.has('/notes/a.md')).toBe(true);
    const list = await store.list();
    expect(list).toEqual([{ uri: '/notes/a.md', at: expect.any(Number) }]);
  });

  it('clears any cached etag for the URI', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    ps.read.mockResolvedValue({ content: new Uint8Array(), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 0 });
    await client.read('/notes/a.md');
    expect(client._etagMap.get('/notes/a.md')).toBeDefined();

    await client.deleteLocal('/notes/a.md');
    expect(client._etagMap.get('/notes/a.md')).toBeUndefined();
  });
});

// ── list filtering ───────────────────────────────────────────────────────────

describe('PodClient.list — tombstone filtering', () => {
  let ps, store, client;
  beforeEach(() => {
    ps     = makePodSource();
    store  = new MemoryTombstones();
    client = makeClient({ podSource: ps, tombstoneStore: store });
    ps.list.mockResolvedValue({
      container: '/c/',
      entries: [{ uri: '/c/a.md' }, { uri: '/c/b.md' }, { uri: '/c/c.md' }],
    });
  });

  it('excludes tombstoned URIs by default', async () => {
    await client.deleteLocal('/c/b.md');
    const r = await client.list('/c/');
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/a.md', '/c/c.md']);
  });

  it('returns tombstoned URIs when includeTombstoned: true', async () => {
    await client.deleteLocal('/c/b.md');
    const r = await client.list('/c/', { includeTombstoned: true });
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/a.md', '/c/b.md', '/c/c.md']);
  });

  it('does not forward includeTombstoned/filter to the underlying source', async () => {
    await client.list('/c/', {
      recursive: true,
      includeTombstoned: true,
      filter: () => true,
    });
    expect(ps.list).toHaveBeenCalledWith('/c/', { recursive: true });
  });

  it('combines a user filter with tombstone filtering', async () => {
    await client.deleteLocal('/c/a.md');
    const r = await client.list('/c/', { filter: (u) => u.endsWith('.md') });
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/b.md', '/c/c.md']);
  });
});

// ── clearTombstone ───────────────────────────────────────────────────────────

describe('PodClient.clearTombstone', () => {
  it('re-includes a previously-tombstoned URI in list output', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    ps.list.mockResolvedValue({ container: '/c/', entries: [{ uri: '/c/a.md' }, { uri: '/c/b.md' }] });

    await client.deleteLocal('/c/a.md');
    let r = await client.list('/c/');
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/b.md']);

    await client.clearTombstone('/c/a.md');
    r = await client.list('/c/');
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/a.md', '/c/b.md']);
  });

  it('is idempotent on an absent tombstone', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });
    await expect(client.clearTombstone('/never-set')).resolves.toBeUndefined();
  });
});

// ── delete / deleteCompletely ────────────────────────────────────────────────

describe('PodClient.delete / deleteCompletely', () => {
  it('calls the pod source delete AND removes any tombstone', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    ps.delete.mockResolvedValue();
    await client.deleteLocal('/c/x.md');
    expect(await store.has('/c/x.md')).toBe(true);

    await client.delete('/c/x.md');
    expect(ps.delete).toHaveBeenCalledWith('/c/x.md', expect.any(Object));
    expect(await store.has('/c/x.md')).toBe(false);
  });

  it('deleteCompletely behaves identically to delete', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    ps.delete.mockResolvedValue();
    await client.deleteLocal('/c/y.md');
    await client.deleteCompletely('/c/y.md');
    expect(ps.delete).toHaveBeenCalledWith('/c/y.md', expect.any(Object));
    expect(await store.has('/c/y.md')).toBe(false);
  });
});

// ── 404-GC on read ───────────────────────────────────────────────────────────

describe('PodClient.read — 404 garbage-collects tombstone', () => {
  it('silently removes the tombstone before re-throwing NotFoundError', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    await client.deleteLocal('/c/gone.md');
    expect(await store.has('/c/gone.md')).toBe(true);

    ps.read.mockRejectedValue(podErr('NOT_FOUND'));
    await expect(client.read('/c/gone.md')).rejects.toThrow();
    expect(await store.has('/c/gone.md')).toBe(false);
  });

  it('does not touch tombstones on non-404 read errors', async () => {
    const ps    = makePodSource();
    const store = new MemoryTombstones();
    const client = makeClient({ podSource: ps, tombstoneStore: store });

    await client.deleteLocal('/c/x.md');
    ps.read.mockRejectedValue(podErr('SERVER_ERROR'));
    await expect(client.read('/c/x.md')).rejects.toThrow();
    expect(await store.has('/c/x.md')).toBe(true);
  });
});

// ── shared TombstoneStore across PodClient instances ─────────────────────────

describe('PodClient — shared tombstoneStore visibility', () => {
  it('two clients sharing one MemoryTombstones see each other tombstones', async () => {
    const ps1 = makePodSource();
    const ps2 = makePodSource();
    const store = new MemoryTombstones();
    const a = makeClient({ podSource: ps1, tombstoneStore: store });
    const b = makeClient({ podSource: ps2, tombstoneStore: store });

    await a.deleteLocal('/c/shared.md');

    ps2.list.mockResolvedValue({ container: '/c/', entries: [{ uri: '/c/shared.md' }, { uri: '/c/other.md' }] });
    const r = await b.list('/c/');
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/other.md']);
  });
});

// ── FileTombstones round-trip ────────────────────────────────────────────────

describe('FileTombstones — persistence round-trip', () => {
  let tmpPath;

  beforeEach(async () => {
    tmpPath = path.join(os.tmpdir(), `onderling-tombstones-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  });

  afterEach(async () => {
    await fs.rm(tmpPath, { force: true });
    await fs.rm(`${tmpPath}.tmp`, { force: true });
  });

  it('persists across close + reopen', async () => {
    const a = new FileTombstones({ path: tmpPath });
    await a.add('/c/a.md');
    await a.add('/c/b.md', { at: 12345 });
    expect(await a.has('/c/a.md')).toBe(true);
    await a.close();

    const b = new FileTombstones({ path: tmpPath });
    expect(await b.has('/c/a.md')).toBe(true);
    expect(await b.has('/c/b.md')).toBe(true);
    const listed = await b.list();
    const bEntry = listed.find((e) => e.uri === '/c/b.md');
    expect(bEntry?.at).toBe(12345);

    await b.remove('/c/a.md');
    await b.close();

    const c = new FileTombstones({ path: tmpPath });
    expect(await c.has('/c/a.md')).toBe(false);
    expect(await c.has('/c/b.md')).toBe(true);
    await c.close();
  });

  it('returns empty list when the file does not exist', async () => {
    const fresh = new FileTombstones({ path: tmpPath });
    expect(await fresh.list()).toEqual([]);
    expect(await fresh.has('/anything')).toBe(false);
    await fresh.close();
  });

  it('survives a corrupt file by starting fresh', async () => {
    await fs.writeFile(tmpPath, 'not json {{{', 'utf8');
    const t = new FileTombstones({ path: tmpPath });
    expect(await t.list()).toEqual([]);
    await t.add('/c/recovered.md');
    expect(await t.has('/c/recovered.md')).toBe(true);
    await t.close();
  });
});
