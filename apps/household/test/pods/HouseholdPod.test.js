/**
 * HouseholdPod.test.js — Phase 2 Stream 2b.
 *
 * Verifies the HouseholdPod path conventions + read/write/list/delete
 * choreography against a small in-memory `MockPodClient`.  No real pod
 * traffic; the mock mirrors only the surface HouseholdPod uses.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { HouseholdPod, TYPE_TO_COLLECTION } from '../../src/pods/HouseholdPod.js';

// ── MockPodClient ──────────────────────────────────────────────────────────
//
// Hierarchical-by-string-key store.  `read` / `write` / `list` / `delete`
// match the (subset of the) `PodClient` surface HouseholdPod consumes:
//
//   read(uri, { decode })  → { content, contentType, etag }
//   write(uri, content, { contentType })
//   list(container, { recursive }) → { container, entries: [{ uri }] }
//   delete(uri)
//
// `list` infers child URIs by prefix-match (lazy LDP container).  Errors
// shaped like `PodClient` errors — `err.code === 'NOT_FOUND'` for missing
// keys.

class NotFoundError extends Error {
  constructor(uri) { super(`NOT_FOUND: ${uri}`); this.code = 'NOT_FOUND'; }
}

class MockPodClient {
  constructor() {
    /** @type {Map<string, { content, contentType }>} */
    this.store = new Map();
    /** @type {Array<{ op, uri }>} */
    this.calls = [];
  }

  async read(uri, opts = {}) {
    this.calls.push({ op: 'read', uri });
    const entry = this.store.get(uri);
    if (!entry) throw new NotFoundError(uri);
    if (opts.decode === 'json') {
      // Mirrors PodClient: stored content is the parsed object (we accept
      // objects in `write`); just clone so callers can't mutate the store.
      return { content: clone(entry.content), contentType: entry.contentType, etag: '"e"' };
    }
    return { content: clone(entry.content), contentType: entry.contentType, etag: '"e"' };
  }

  async write(uri, content, opts = {}) {
    this.calls.push({ op: 'write', uri });
    this.store.set(uri, { content: clone(content), contentType: opts.contentType ?? 'application/json' });
    return { uri, contentType: opts.contentType ?? 'application/json', etag: '"e"' };
  }

  async list(containerUri, opts = {}) {
    this.calls.push({ op: 'list', uri: containerUri });
    if (!containerUri.endsWith('/')) {
      throw new Error(`MockPodClient.list: container must end with '/' (got '${containerUri}')`);
    }
    // We synthesise a "container exists if anything is under it" rule.
    const prefix = containerUri;
    const entries = [];
    for (const key of this.store.keys()) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length);
      if (!rest) continue;
      if (opts.recursive) {
        entries.push({ uri: key });
      } else {
        // Non-recursive: only direct children.  If `rest` contains a `/`,
        // surface the sub-container path itself (LDP-style) rather than
        // the deep file.  HouseholdPod doesn't need sub-container entries
        // — it filters by `.json` — so we just skip them.
        if (rest.includes('/')) continue;
        entries.push({ uri: key });
      }
    }
    if (entries.length === 0) {
      // Mock 404 only if there isn't a single key under the prefix.
      // (Real pods 404 for never-created containers; we mimic that.)
      const anyDescendant = [...this.store.keys()].some((k) => k.startsWith(prefix));
      if (!anyDescendant) throw new NotFoundError(containerUri);
    }
    return { container: containerUri, entries };
  }

  async delete(uri) {
    this.calls.push({ op: 'delete', uri });
    if (!this.store.has(uri)) throw new NotFoundError(uri);
    this.store.delete(uri);
  }
}

function clone(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

// ── helpers ────────────────────────────────────────────────────────────────

const POD_ROOT = 'https://pod.example/household/';

function makePod() {
  const mock = new MockPodClient();
  const hh = new HouseholdPod({ podClient: mock, podRoot: POD_ROOT });
  return { mock, hh };
}

function makeItem(overrides = {}) {
  // Rich task shape: a fresh household item is shared (no `assignee`) and
  // open (`completedAt` absent), so neither field is set explicitly.
  return {
    id:          '01HXY000000000000000000001',
    type:        'shopping',
    text:        'milk',
    addedBy:     'https://id.example/alice',
    addedAt:     1_700_000_000_000,
    source:      { tg: { chatId: 'c1', messageId: 'm1' } },
    ...overrides,
  };
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('HouseholdPod — construction', () => {
  it('requires podClient + podRoot', () => {
    expect(() => new HouseholdPod({})).toThrow(/podClient is required/);
    expect(() => new HouseholdPod({ podClient: new MockPodClient() })).toThrow(/podRoot is required/);
  });

  it('normalises podRoot to end with a slash', () => {
    const hh1 = new HouseholdPod({ podClient: new MockPodClient(), podRoot: 'https://x/h' });
    const hh2 = new HouseholdPod({ podClient: new MockPodClient(), podRoot: 'https://x/h/' });
    expect(hh1.podRoot).toBe('https://x/h/');
    expect(hh2.podRoot).toBe('https://x/h/');
  });
});

describe('HouseholdPod — TYPE_TO_COLLECTION', () => {
  it('maps every ItemType to its directory name', () => {
    expect(TYPE_TO_COLLECTION).toEqual({
      shopping: 'groceries',
      errand:   'errands',
      repair:   'repairs',
      schedule: 'schedule',
    });
  });

  it('is frozen so a typo elsewhere can\'t silently rewrite the layout', () => {
    expect(Object.isFrozen(TYPE_TO_COLLECTION)).toBe(true);
  });
});

describe('HouseholdPod.addItem', () => {
  it('writes shopping items to <root>groceries/open/<id>.json', async () => {
    const { mock, hh } = makePod();
    const item = makeItem({ id: 'AAA', type: 'shopping' });
    const { uri } = await hh.addItem(item);
    expect(uri).toBe(`${POD_ROOT}groceries/open/AAA.json`);
    expect(mock.store.has(uri)).toBe(true);
    expect(mock.store.get(uri).content).toEqual(item);
  });

  it('writes errand / repair / schedule items to the right collection', async () => {
    const { mock, hh } = makePod();
    await hh.addItem(makeItem({ id: 'E', type: 'errand' }));
    await hh.addItem(makeItem({ id: 'R', type: 'repair' }));
    await hh.addItem(makeItem({ id: 'S', type: 'schedule' }));
    expect(mock.store.has(`${POD_ROOT}errands/open/E.json`)).toBe(true);
    expect(mock.store.has(`${POD_ROOT}repairs/open/R.json`)).toBe(true);
    expect(mock.store.has(`${POD_ROOT}schedule/open/S.json`)).toBe(true);
  });

  it('rejects items missing id or type', async () => {
    const { hh } = makePod();
    await expect(hh.addItem({ id: 'X' })).rejects.toThrow(/id and item.type/);
    await expect(hh.addItem({ type: 'shopping' })).rejects.toThrow(/id and item.type/);
  });

  it('rejects items with an unknown type', async () => {
    const { hh } = makePod();
    await expect(hh.addItem(makeItem({ type: 'banana' }))).rejects.toThrow(/unknown item type/);
  });
});

describe('HouseholdPod.listOpen', () => {
  it('without filter, walks every collection and returns parsed items', async () => {
    const { hh } = makePod();
    await hh.addItem(makeItem({ id: 'A', type: 'shopping', addedAt: 100 }));
    await hh.addItem(makeItem({ id: 'B', type: 'errand',   addedAt: 200 }));
    await hh.addItem(makeItem({ id: 'C', type: 'repair',   addedAt: 300 }));
    await hh.addItem(makeItem({ id: 'D', type: 'schedule', addedAt: 400 }));
    const items = await hh.listOpen();
    expect(items.map((i) => i.id)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('returns sorted by addedAt ASC even when written out of order', async () => {
    const { hh } = makePod();
    await hh.addItem(makeItem({ id: 'late',  type: 'shopping', addedAt: 999 }));
    await hh.addItem(makeItem({ id: 'early', type: 'shopping', addedAt: 1 }));
    await hh.addItem(makeItem({ id: 'mid',   type: 'shopping', addedAt: 500 }));
    const items = await hh.listOpen();
    expect(items.map((i) => i.id)).toEqual(['early', 'mid', 'late']);
  });

  it('with { type } only walks the relevant collection', async () => {
    const { mock, hh } = makePod();
    await hh.addItem(makeItem({ id: 'A', type: 'shopping' }));
    await hh.addItem(makeItem({ id: 'B', type: 'errand' }));
    mock.calls.length = 0;
    const items = await hh.listOpen({ type: 'errand' });
    expect(items.map((i) => i.id)).toEqual(['B']);
    // Only one container should have been list()ed.
    const lists = mock.calls.filter((c) => c.op === 'list');
    expect(lists).toHaveLength(1);
    expect(lists[0].uri).toBe(`${POD_ROOT}errands/open/`);
  });

  it('returns empty when nothing has been written yet (no NOT_FOUND propagation)', async () => {
    const { hh } = makePod();
    const items = await hh.listOpen();
    expect(items).toEqual([]);
  });
});

describe('HouseholdPod.markComplete', () => {
  it('moves the item to done/<yyyy-mm>/, deletes the open copy, sets completedAt', async () => {
    const { mock, hh } = makePod();
    const item = makeItem({ id: 'M1', type: 'shopping' });
    await hh.addItem(item);
    const before = Date.now();
    const archived = await hh.markComplete('M1');
    const after = Date.now();

    expect(archived.completedAt).toBeGreaterThanOrEqual(before);
    expect(archived.completedAt).toBeLessThanOrEqual(after);

    // Open copy gone, done copy present at the right path.
    expect(mock.store.has(`${POD_ROOT}groceries/open/M1.json`)).toBe(false);
    const expectedYyyymm = new Date(archived.completedAt).toISOString().slice(0, 7);
    const doneUri = `${POD_ROOT}groceries/done/${expectedYyyymm}/M1.json`;
    expect(mock.store.has(doneUri)).toBe(true);
    expect(mock.store.get(doneUri).content).toEqual(archived);
  });

  it('throws when the id is not in any open collection', async () => {
    const { hh } = makePod();
    await expect(hh.markComplete('does-not-exist')).rejects.toThrow(/id not found/);
  });
});

describe('HouseholdPod.remove', () => {
  it('hard-deletes the open item', async () => {
    const { mock, hh } = makePod();
    await hh.addItem(makeItem({ id: 'X', type: 'repair' }));
    expect(mock.store.has(`${POD_ROOT}repairs/open/X.json`)).toBe(true);
    await hh.remove('X');
    expect(mock.store.has(`${POD_ROOT}repairs/open/X.json`)).toBe(false);
  });

  it('throws when the id is not found', async () => {
    const { hh } = makePod();
    await expect(hh.remove('nope')).rejects.toThrow(/id not found/);
  });
});

describe('HouseholdPod.getById', () => {
  it('searches open first, then done', async () => {
    const { hh } = makePod();
    await hh.addItem(makeItem({ id: 'OPEN', type: 'errand' }));
    await hh.addItem(makeItem({ id: 'DONE', type: 'errand' }));
    await hh.markComplete('DONE');

    const open = await hh.getById('OPEN');
    expect(open?.id).toBe('OPEN');
    expect(open?.completedAt).toBeUndefined();

    const done = await hh.getById('DONE');
    expect(done?.id).toBe('DONE');
    expect(typeof done?.completedAt).toBe('number');
  });

  it('returns null when the id is missing entirely', async () => {
    const { hh } = makePod();
    expect(await hh.getById('missing')).toBeNull();
  });
});

describe('HouseholdPod refs', () => {
  /** @returns {import('../../src/types.js').ItemRef} */
  function makeRef(overrides = {}) {
    return {
      id:           'R1',
      type:         'errand',
      ownerWebid:   'https://id.example/alice',
      ownerPodRoot: 'https://alice.example/',
      relPath:      'private/errands.json#R1',
      addedAt:      1_700_000_000_000,
      ...overrides,
    };
  }

  it('writeRef writes /household/refs/<id>.json', async () => {
    const { mock, hh } = makePod();
    const ref = makeRef({ id: 'R-AAA' });
    await hh.writeRef(ref);
    expect(mock.store.has(`${POD_ROOT}refs/R-AAA.json`)).toBe(true);
    expect(mock.store.get(`${POD_ROOT}refs/R-AAA.json`).content).toEqual(ref);
  });

  it('writeRef rejects refs without an id', async () => {
    const { hh } = makePod();
    await expect(hh.writeRef({ type: 'errand' })).rejects.toThrow(/ref.id is required/);
  });

  it('listRefs enumerates all refs sorted by addedAt', async () => {
    const { hh } = makePod();
    await hh.writeRef({ id: 'late',  type: 'errand', ownerWebid: 'a', ownerPodRoot: 'b', relPath: 'c', addedAt: 999 });
    await hh.writeRef({ id: 'early', type: 'errand', ownerWebid: 'a', ownerPodRoot: 'b', relPath: 'c', addedAt: 1 });
    const refs = await hh.listRefs();
    expect(refs.map((r) => r.id)).toEqual(['early', 'late']);
  });

  it('listRefs filters by type when requested', async () => {
    const { hh } = makePod();
    await hh.writeRef({ id: 'e1', type: 'errand',   ownerWebid: 'a', ownerPodRoot: 'b', relPath: 'c', addedAt: 1 });
    await hh.writeRef({ id: 's1', type: 'schedule', ownerWebid: 'a', ownerPodRoot: 'b', relPath: 'c', addedAt: 2 });
    const errands = await hh.listRefs({ type: 'errand' });
    expect(errands.map((r) => r.id)).toEqual(['e1']);
  });

  it('listRefs returns [] when /refs/ is empty (no NOT_FOUND surface)', async () => {
    const { hh } = makePod();
    expect(await hh.listRefs()).toEqual([]);
  });
});

describe('HouseholdPod.readConfig / writeConfig', () => {
  it('returns null before init', async () => {
    const { hh } = makePod();
    expect(await hh.readConfig()).toBeNull();
  });

  it('round-trips a HouseholdConfig', async () => {
    const { hh } = makePod();
    /** @type {import('../../src/types.js').HouseholdConfig} */
    const cfg = {
      name:       'De Roos',
      groupKeyId: 'g1',
      botWebid:   'https://bot.example/#me',
      members: [
        { webid: 'https://id.example/alice', displayName: 'Alice', role: 'admin', podRoot: 'https://alice.example/' },
      ],
      settings: { tz: 'Europe/Amsterdam' },
    };
    await hh.writeConfig(cfg);
    expect(await hh.readConfig()).toEqual(cfg);
  });
});
