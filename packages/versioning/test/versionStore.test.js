import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';

import { createVersionStore, DEFAULT_VERSIONS_PER_SERIES } from '../src/versionStore.js';

/**
 * Minimal StorageBackend for tests — the get/put/delete/list subset the store
 * needs, matching @onderling/pseudo-pod's MemoryBackend contract (get→{bytes},
 * put(key,bytes), delete, list(prefix)→sorted keys). Kept inline so the
 * substrate package stays dependency-free.
 */
function memBackend() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? { bytes: store.get(key), etag: `"${key}"` } : null; },
    async put(key, bytes) { store.set(key, bytes); return { etag: `"${key}"`, _v: 1 }; },
    async delete(key) { store.delete(key); },
    async list(prefix) { return [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); },
    _size: () => store.size,
  };
}

/** Async sha256→hex (the injected hash seam; substrate itself imports no crypto). */
const sha256 = async (content) => {
  const h = createHash('sha256');
  if (typeof content === 'string') h.update(content, 'utf8');
  else h.update(Buffer.from(content));
  return h.digest('hex');
};

/** A store + a fake live resource map, with a controllable clock. */
function makeStore(overrides = {}) {
  const backend = memBackend();
  const live = new Map();
  let t = 1_000_000;
  const store = createVersionStore({
    backend,
    hash: sha256,
    now: () => t,
    readLive: async (uri) => live.get(uri),
    writeLive: async (uri, content) => { live.set(uri, content); },
    ...overrides,
  });
  return {
    store,
    backend,
    live,
    tick: (by = 1) => { t += by; },
    setNow: (v) => { t = v; },
    now: () => t,
  };
}

describe('createVersionStore — construction', () => {
  it('rejects a backend missing the required methods', () => {
    expect(() => createVersionStore({ backend: {}, hash: sha256 })).toThrow(/backend must implement/);
  });
  it('rejects a non-function hash', () => {
    expect(() => createVersionStore({ backend: memBackend(), hash: null })).toThrow(/hash must be a function/);
  });
});

describe('capture — policy preserved from versions.js', () => {
  it('captures a version and lists it', async () => {
    const { store } = makeStore();
    const res = await store.capture('note.md', 'hello');
    expect(res.captured).toBe(true);
    expect(res.sha256).toBe(await sha256('hello'));
    expect(res.size).toBe(5);

    const versions = await store.list('note.md');
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ ts: res.ts, sha256: res.sha256, size: 5 });
  });

  it('skips the first snapshot of empty content (EMPTY_FIRST_VERSION)', async () => {
    const { store } = makeStore();
    const res = await store.capture('empty.md', '');
    expect(res).toEqual({ captured: false, reason: 'EMPTY_FIRST_VERSION' });
    expect(await store.list('empty.md')).toHaveLength(0);
  });

  it('does capture empty content once a history exists', async () => {
    const { store, tick } = makeStore();
    await store.capture('f.md', 'content');
    tick(10_000); // past the debounce window
    const res = await store.capture('f.md', '');
    expect(res.captured).toBe(true);
    expect(await store.list('f.md')).toHaveLength(2);
  });

  it('debounces an identical sha within the debounce window (DEBOUNCED)', async () => {
    const { store, tick } = makeStore();
    await store.capture('f.md', 'same');
    tick(100); // < 5000ms
    const res = await store.capture('f.md', 'same');
    expect(res).toEqual({ captured: false, reason: 'DEBOUNCED' });
    expect(await store.list('f.md')).toHaveLength(1);
  });

  it('captures identical content again once the debounce window has passed', async () => {
    const { store, tick } = makeStore();
    await store.capture('f.md', 'same');
    tick(6_000); // > 5000ms
    const res = await store.capture('f.md', 'same');
    expect(res.captured).toBe(true);
    expect(await store.list('f.md')).toHaveLength(2);
  });

  it('captures different content immediately (no debounce)', async () => {
    const { store } = makeStore();
    await store.capture('f.md', 'a');
    const res = await store.capture('f.md', 'b');
    expect(res.captured).toBe(true);
    expect(await store.list('f.md')).toHaveLength(2);
  });

  it('refuses to version the version store itself (no versions-of-versions)', async () => {
    const { store } = makeStore();
    const res = await store.capture('versions/whatever', 'x');
    expect(res).toEqual({ captured: false, reason: 'NOT_VERSIONABLE' });
  });

  it('honours a shouldVersion opt-out predicate', async () => {
    const { store } = makeStore({
      retention: { shouldVersion: (uri) => !uri.endsWith('.tmp') },
    });
    expect((await store.capture('a.tmp', 'x')).reason).toBe('NOT_VERSIONABLE');
    expect((await store.capture('a.md', 'x')).captured).toBe(true);
  });
});

describe('ordering + collision', () => {
  it('lists newest-first', async () => {
    const { store, tick } = makeStore();
    await store.capture('f.md', 'v1'); tick(6_000);
    await store.capture('f.md', 'v2'); tick(6_000);
    await store.capture('f.md', 'v3');
    const versions = await store.list('f.md');
    expect(versions.map((v) => v.ts)).toEqual([...versions.map((v) => v.ts)].sort((a, b) => b - a));
    expect(await store.read('f.md', versions[0].ts)).toBe('v3');
  });

  it('keeps ts strictly increasing on same-millisecond captures (collision tiebreak)', async () => {
    const { store } = makeStore(); // clock frozen — every capture requests the same now
    const a = await store.capture('f.md', 'a');
    const b = await store.capture('f.md', 'b');
    const c = await store.capture('f.md', 'c');
    expect(b.ts).toBe(a.ts + 1);
    expect(c.ts).toBe(b.ts + 1);
    expect(await store.list('f.md')).toHaveLength(3);
  });
});

describe('retention', () => {
  it('enforces the per-series cap, evicting oldest', async () => {
    const { store, tick } = makeStore({ retention: { perSeries: 3, debounceMs: 0 } });
    for (let i = 0; i < 6; i++) { await store.capture('f.md', `v${i}`); tick(1); }
    const versions = await store.list('f.md');
    expect(versions).toHaveLength(3);
    // Newest three survive; oldest evicted.
    expect(await store.read('f.md', versions[0].ts)).toBe('v5');
    await expect(store.read('f.md', versions[2].ts - 100)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('defaults the per-series cap to 50', async () => {
    const { store } = makeStore({ retention: { debounceMs: 0 } });
    for (let i = 0; i < DEFAULT_VERSIONS_PER_SERIES + 5; i++) await store.capture('f.md', `v${i}`);
    expect(await store.list('f.md')).toHaveLength(DEFAULT_VERSIONS_PER_SERIES);
  });
});

describe('read', () => {
  it('returns raw content of a snapshot', async () => {
    const { store } = makeStore();
    const r = await store.capture('f.md', 'payload');
    expect(await store.read('f.md', r.ts)).toBe('payload');
  });

  it('throws VERSION_NOT_FOUND for a missing snapshot', async () => {
    const { store } = makeStore();
    await store.capture('f.md', 'x');
    await expect(store.read('f.md', 999)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });

  it('round-trips binary (Uint8Array) content', async () => {
    const { store } = makeStore();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const r = await store.capture('img.bin', bytes);
    expect(r.size).toBe(4);
    expect(await store.read('img.bin', r.ts)).toEqual(bytes);
  });

  it('list({ withContent }) returns content inline for each version', async () => {
    const { store, tick } = makeStore({ retention: { debounceMs: 0 } });
    await store.capture('n.md', 'a'); tick(1);
    await store.capture('n.md', 'b');
    const withC = await store.list('n.md', { withContent: true });
    expect(withC.map((v) => v.content)).toEqual(['b', 'a']); // newest-first
    const withoutC = await store.list('n.md');
    expect(withoutC[0].content).toBeUndefined();
  });
});

describe('restore — undoable (the crown jewel)', () => {
  it('restores an old version AND snapshots current first so the restore is itself undoable', async () => {
    const { store, live, tick } = makeStore();
    live.set('f.md', 'v1');
    await store.capture('f.md', 'v1'); tick(6_000);
    live.set('f.md', 'v2');
    const v2 = await store.capture('f.md', 'v2'); tick(6_000);
    live.set('f.md', 'v3-current');
    tick(6_000);

    // restore v1
    const versions = await store.list('f.md');
    const v1ts = versions.find((v) => v.ts < v2.ts).ts;
    const res = await store.restore('f.md', v1ts);

    expect(res.restoredFromMs).toBe(v1ts);
    expect(live.get('f.md')).toBe('v1');            // live now holds the restored content
    expect(res.snapshotMsBeforeRestore).not.toBeNull(); // current ('v3-current') was snapshotted first

    // the pre-restore snapshot is recoverable → the restore is undoable
    expect(await store.read('f.md', res.snapshotMsBeforeRestore)).toBe('v3-current');
  });

  it('throws NOT_VERSIONABLE / VERSION_NOT_FOUND appropriately', async () => {
    const { store } = makeStore();
    await expect(store.restore('versions/x', 1)).rejects.toMatchObject({ code: 'NOT_VERSIONABLE' });
    await store.capture('f.md', 'x');
    await expect(store.restore('f.md', 12345)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});

describe('drop + listSeries', () => {
  it('drops a whole series', async () => {
    const { store, tick } = makeStore({ retention: { debounceMs: 0 } });
    await store.capture('f.md', 'a'); tick(1);
    await store.capture('f.md', 'b');
    const deleted = await store.drop('f.md');
    expect(deleted).toBe(2);
    expect(await store.list('f.md')).toHaveLength(0);
  });

  it('lists all series newest-first with counts, and handles uris with slashes', async () => {
    const { store, tick } = makeStore({ retention: { debounceMs: 0 } });
    await store.capture('a.md', '1'); tick(1);
    await store.capture('sub/dir/b.md', '1'); tick(1);
    await store.capture('sub/dir/b.md', '2');
    const series = await store.listSeries();
    expect(series.map((s) => s.uri)).toEqual(['sub/dir/b.md', 'a.md']); // b is newest
    const b = series.find((s) => s.uri === 'sub/dir/b.md');
    expect(b.count).toBe(2);
  });

  it('does not let a series prefix bleed into a sibling (uri "a" vs "ab")', async () => {
    const { store } = makeStore();
    await store.capture('a', 'x');
    await store.capture('ab', 'y');
    expect(await store.list('a')).toHaveLength(1);
    expect(await store.list('ab')).toHaveLength(1);
  });
});

describe('multi-writer (writerId) — concurrent devices on a shared backend', () => {
  it('two writers capturing the same uri at the same ms do NOT clobber each other', async () => {
    const backend = memBackend();
    const t = 5_000_000; // both clocks frozen at the same ms
    const mk = (w) => createVersionStore({
      backend, hash: sha256, now: () => t, writerId: w,
    });
    const devA = mk('dev-A');
    const devB = mk('dev-B');

    // Simulate the race: both read the (same) series state, then both write.
    const [ra, rb] = await Promise.all([
      devA.capture('shared.md', 'from A'),
      devB.capture('shared.md', 'from B'),
    ]);
    expect(ra.captured).toBe(true);
    expect(rb.captured).toBe(true);
    expect(ra.id).not.toBe(rb.id); // distinct keys — no silent clobber

    const versions = await devA.list('shared.md');
    expect(versions).toHaveLength(2);
    expect(new Set(versions.map((v) => v.writer))).toEqual(new Set(['dev-A', 'dev-B']));
  });

  it('read/restore resolve by full id (exact) and by numeric ts (newest match)', async () => {
    const backend = memBackend();
    const live = new Map();
    let t = 1_000;
    const mk = (w) => createVersionStore({
      backend, hash: sha256, now: () => t, writerId: w,
      readLive: async (uri) => live.get(uri),
      writeLive: async (uri, c) => { live.set(uri, c); },
    });
    const devA = mk('A');
    const devB = mk('B');
    // Genuine race: both read the empty series state before either writes →
    // both land on the same ts, disambiguated only by the writer suffix.
    // (Sequential captures instead get the monotonic ts bump — separate path.)
    const [ra, rb] = await Promise.all([
      devA.capture('n.md', 'a-content'),
      devB.capture('n.md', 'b-content'),
    ]);
    expect(rb.ts).toBe(ra.ts);

    // Full id → exact snapshot.
    expect(await devA.read('n.md', ra.id)).toBe('a-content');
    expect(await devA.read('n.md', rb.id)).toBe('b-content');
    // Numeric ts (ambiguous across writers) → the newest-sorted match, deterministically.
    expect(await devA.read('n.md', ra.ts)).toBe('b-content'); // writer 'B' sorts before 'A'

    // Restore by id round-trips to the live resource.
    live.set('n.md', 'current');
    const res = await devB.restore('n.md', ra.id);
    expect(res.restoredFromMs).toBe(ra.ts);
    expect(live.get('n.md')).toBe('a-content');
  });

  it('listSeries counts writer-suffixed keys', async () => {
    const backend = memBackend();
    const t = 9_000;
    const dev = createVersionStore({ backend, hash: sha256, now: () => t, writerId: 'dev-1' });
    await dev.capture('x.md', 'v1');
    const series = await dev.listSeries();
    expect(series).toEqual([{ uri: 'x.md', latestMs: t, count: 1 }]);
  });

  it('single-writer stores (no writerId) keep plain-ts ids — backward compatible', async () => {
    const { store } = makeStore();
    const r = await store.capture('f.md', 'x');
    expect(r.id).toBe(String(r.ts));
    const versions = await store.list('f.md');
    expect(versions[0].writer).toBeUndefined();
  });
});

// ── Folio port: the dotted-segment `shouldVersion` reject ────────────────────
//
// Collapsed here from the two byte-identical `versions.test.js` suites (Folio +
// sync-engine) when Folio's `versions.js` retired onto this substrate
// (PLAN-folio-as-file-agent). The SEMANTIC cases (debounce, retention
// cap, newest-first ordering, undoable restore, read-content, empty-first-skip)
// are already covered above and are backend-agnostic; the block below adds the
// one Folio-specific rule — reject ANY relPath with a dotted segment
// (`.folio/`, `.onderling/`, `.git/`, …), absolute paths, and `.`/`..` — carried
// via `retention.shouldVersion` (the substrate's own `versionable` only rejects
// the versions-root prefix).
//
// DROPPED, NOT PORTED (recorded honestly):
//   - The on-disk FS-LAYOUT assertions (`.folio/versions/<rel>/<ts>.<ext>`
//     paths + `.sha256` sidecars + sidecar rebuild) — snapshots are opaque
//     records now, so there are no browsable files/paths to assert on.
//   - The 100 MB WHOLE-TREE BYTE BUDGET (`pruneVersions` global eviction) — the
//     substrate enforces the per-series cap ONLY (per-series retention is the
//     `retention.perSeries` case above); the cross-series byte budget is gone
//     until/unless re-added via an index record.
//
// This is Folio's real `isVersionable` rule, ported verbatim from `versions.js`.
const isVersionableRel = (relPath) => {
  if (typeof relPath !== 'string' || relPath.length === 0) return false;
  const norm = relPath.replace(/\\/g, '/');
  if (norm.startsWith('/')) return false;
  const segs = norm.split('/');
  if (segs.some((s) => s === '' || s === '..' || s === '.' || s.startsWith('.'))) return false;
  return true;
};

describe('Folio shouldVersion — dotted-segment reject (isVersionable rule)', () => {
  const makeFolioStore = () => makeStore({ retention: { shouldVersion: isVersionableRel } });

  it('accepts plain markdown / nested / spaced paths', () => {
    const { store } = makeFolioStore();
    expect(store.isVersionable('a.md')).toBe(true);
    expect(store.isVersionable('sub/dir/note.md')).toBe(true);
    expect(store.isVersionable('file with spaces.txt')).toBe(true);
  });

  it('rejects empty / dotted / absolute / .. / . paths', () => {
    const { store } = makeFolioStore();
    expect(store.isVersionable('')).toBe(false);
    expect(store.isVersionable('.folio/versions/a.md')).toBe(false);
    expect(store.isVersionable('.onderling/state.json')).toBe(false);
    expect(store.isVersionable('/abs/path')).toBe(false);
    expect(store.isVersionable('a/../b')).toBe(false);
    expect(store.isVersionable('a/.hidden/c.md')).toBe(false);
    expect(store.isVersionable('.dotfile')).toBe(false);
  });

  it('capture of a dotted path is a NOT_VERSIONABLE no-op (no versions of versions)', async () => {
    const { store } = makeFolioStore();
    const r = await store.capture('.folio/foo.md', 'x');
    expect(r).toEqual({ captured: false, reason: 'NOT_VERSIONABLE' });
    expect(await store.list('.folio/foo.md')).toEqual([]);
  });

  it('restore / read of a dotted path reject appropriately', async () => {
    const { store } = makeFolioStore();
    await expect(store.restore('.folio/secret', 1)).rejects.toMatchObject({ code: 'NOT_VERSIONABLE' });
    // read() has no versionable guard, but a dotted series is never captured,
    // so its history is always empty → VERSION_NOT_FOUND.
    await expect(store.read('.folio/secret', 1)).rejects.toMatchObject({ code: 'VERSION_NOT_FOUND' });
  });
});
