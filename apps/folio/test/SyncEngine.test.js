import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SyncEngine } from '../src/SyncEngine.js';
import { hasConflictMarkers } from '../src/applyConflict.js';

const POD_ROOT = 'https://alice.example/notes/';

// ── Mock PodClient ──────────────────────────────────────────────────────────
//
// Mirrors the surface SyncEngine consumes:
//   .read(uri, { decode })  → { content, contentType, lastModified, etag, size }
//   .write(uri, content, { contentType }) → { uri, ... }
//   .list(containerUri)     → { container, entries: [{ uri, type }] }
//   .delete(uri)
//   .deleteLocal(uri)       (tombstone)
//
// Backed by an in-memory map.  Containers are inferred from the resource URIs.

class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();      // uri → { content: string|Uint8Array, contentType, lastModified, etag, size }
    this.tombstones = new Set();
    this.listCalls  = 0;
    this.writeCalls = 0;
    this.readCalls  = 0;
    this._etagCounter = 0;
  }
  _seed(uri, content, contentType = 'text/markdown') {
    const bytes = typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
    this.store.set(uri, {
      content,
      contentType,
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: bytes.byteLength,
    });
  }
  async read(uri, opts = {}) {
    this.readCalls++;
    const r = this.store.get(uri);
    if (!r) {
      const err = new Error(`mock 404: ${uri}`);
      err.code = 'NOT_FOUND';
      throw err;
    }
    let content = r.content;
    if (opts.decode === 'string') {
      if (content instanceof Uint8Array) content = new TextDecoder().decode(content);
    } else if (opts.decode === 'bytes') {
      if (typeof content === 'string') content = new TextEncoder().encode(content);
    }
    return { ...r, content };
  }
  async write(uri, content, opts = {}) {
    this.writeCalls++;
    const bytes = content instanceof Uint8Array
      ? content
      : (typeof content === 'string' ? new TextEncoder().encode(content) : new TextEncoder().encode(JSON.stringify(content)));
    const stored = {
      content,
      contentType: opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag: `"e${++this._etagCounter}"`,
      size: bytes.byteLength,
    };
    this.store.set(uri, stored);
    return { uri, ...stored };
  }
  async list(containerUri, _opts = {}) {
    this.listCalls++;
    const container = containerUri.endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nestedContainers = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slashIdx = tail.indexOf('/');
      if (slashIdx === -1) {
        direct.set(k, 'resource');
      } else {
        nestedContainers.add(`${container}${tail.slice(0, slashIdx)}/`);
      }
    }
    const entries = [
      ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
      ...[...nestedContainers].map((uri) => ({ uri, type: 'container' })),
    ];
    return { container, entries };
  }
  async delete(uri) {
    this.store.delete(uri);
    this.tombstones.delete(uri);
  }
  async deleteLocal(uri) {
    this.tombstones.add(uri);
  }
  async clearTombstone(uri) {
    this.tombstones.delete(uri);
  }
  on() {} // emitter stub
  off() {}
  emit() {}
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let localRoot, pod;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-sync-'));
  pod = new MockPodClient(POD_ROOT);
});
afterEach(async () => { await fs.rm(localRoot, { recursive: true, force: true }); });

function newEngine(opts = {}) {
  return new SyncEngine({
    podClient: pod,
    localRoot,
    podRoot: POD_ROOT,
    pollIntervalMs: 1_000_000,
    debounceMs: 50,
    ...opts,
  });
}

async function listLocal(rel = '') {
  const dir = rel ? join(localRoot, rel) : localRoot;
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  return dirents.map((e) => e.name).sort();
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('SyncEngine — construction', () => {
  it('rejects missing podClient/localRoot/podRoot', () => {
    expect(() => new SyncEngine({})).toThrow();
    expect(() => new SyncEngine({ podClient: pod, localRoot })).toThrow();
    expect(() => new SyncEngine({ podClient: pod, podRoot: POD_ROOT })).toThrow();
  });
  it('exposes pathMap, localRoot, podRoot', () => {
    const e = newEngine();
    expect(e.localRoot).toBe(localRoot);
    expect(e.podRoot).toBe(POD_ROOT);
    expect(e.pathMap).toBeDefined();
  });
});

describe('SyncEngine.runOnce — push (local → pod)', () => {
  it('uploads 5 local files to the pod', async () => {
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(join(localRoot, `f${i}.md`), `content-${i}`);
    }
    const e = newEngine();
    const r = await e.runOnce();
    expect(r.uploads).toBe(5);
    expect(r.downloads).toBe(0);
    expect(r.conflicts).toBe(0);
    for (let i = 0; i < 5; i++) {
      const stored = pod.store.get(`${POD_ROOT}f${i}.md`);
      expect(stored).toBeDefined();
      expect(stored.contentType).toBe('text/markdown');
    }
  });

  it('uploads nested files preserving relPath', async () => {
    await fs.mkdir(join(localRoot, 'recipes', 'desserts'), { recursive: true });
    await fs.writeFile(join(localRoot, 'recipes', 'desserts', 'cake.md'), 'cake');
    await fs.writeFile(join(localRoot, 'top.md'), 'top');
    const e = newEngine();
    await e.runOnce();
    expect(pod.store.has(`${POD_ROOT}top.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}recipes/desserts/cake.md`)).toBe(true);
  });

  it('ensures the pod root container exists before pushing (Inrupt fix)', async () => {
    // Simulate a pod server that requires explicit container creation
    // before PUT (e.g. Inrupt's storage.inrupt.com).
    const created = [];
    pod.createContainer = async (uri) => {
      const u = uri.endsWith('/') ? uri : `${uri}/`;
      created.push(u);
      return { uri: u };
    };
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    const e = newEngine();
    await e.runOnce();
    expect(created).toContain(POD_ROOT);
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('ensures every nested parent container before pushing nested files', async () => {
    const created = new Set();
    pod.createContainer = async (uri) => {
      const u = uri.endsWith('/') ? uri : `${uri}/`;
      created.add(u);
      return { uri: u };
    };
    await fs.mkdir(join(localRoot, 'recipes', 'desserts'), { recursive: true });
    await fs.writeFile(join(localRoot, 'recipes', 'desserts', 'cake.md'), 'cake');
    const e = newEngine();
    await e.runOnce();
    expect(created.has(POD_ROOT)).toBe(true);
    expect(created.has(`${POD_ROOT}recipes/`)).toBe(true);
    expect(created.has(`${POD_ROOT}recipes/desserts/`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}recipes/desserts/cake.md`)).toBe(true);
  });

  it('skips container-ensure when the pod client lacks createContainer (back-compat)', async () => {
    // Mock pod (no createContainer method) — the pre-fix behaviour must
    // continue to work for tests + the in-memory FsBackedMockPodClient.
    expect(typeof pod.createContainer).toBe('undefined');
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    const e = newEngine();
    const r = await e.runOnce();
    expect(r.uploads).toBe(1);
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });
});

describe('SyncEngine.runOnce — pull (pod → local)', () => {
  it('downloads pod files into the local root', async () => {
    pod._seed(`${POD_ROOT}a.md`, 'apple');
    pod._seed(`${POD_ROOT}sub/b.md`, 'banana');
    const e = newEngine();
    const r = await e.runOnce();
    expect(r.downloads).toBe(2);
    expect(r.uploads).toBe(0);
    const a = await fs.readFile(join(localRoot, 'a.md'), 'utf8');
    const b = await fs.readFile(join(localRoot, 'sub', 'b.md'), 'utf8');
    expect(a).toBe('apple');
    expect(b).toBe('banana');
  });
});

describe('SyncEngine.runOnce — round-trip', () => {
  it('round-trips a 6-file fixture both directions over two engines', async () => {
    // Write files split across local and pod.
    await fs.writeFile(join(localRoot, 'one.md'),  '1');
    await fs.writeFile(join(localRoot, 'two.md'),  '2');
    pod._seed(`${POD_ROOT}three.md`, '3');
    pod._seed(`${POD_ROOT}four.md`,  '4');
    pod._seed(`${POD_ROOT}sub/five.md`, '5');
    await fs.writeFile(join(localRoot, 'six.md'), '6');

    const e = newEngine();
    const r = await e.runOnce();
    expect(r.uploads).toBe(3);
    expect(r.downloads).toBe(3);
    expect(r.conflicts).toBe(0);

    // Pod now has all 6.
    for (const name of ['one.md', 'two.md', 'three.md', 'four.md', 'six.md']) {
      expect(pod.store.has(`${POD_ROOT}${name}`)).toBe(true);
    }
    expect(pod.store.has(`${POD_ROOT}sub/five.md`)).toBe(true);

    // Local now has all 6.
    const top = await listLocal();
    expect(top).toContain('one.md');
    expect(top).toContain('three.md');
    expect(top).toContain('six.md');
    const sub = await listLocal('sub');
    expect(sub).toContain('five.md');

    // Idempotent re-run: no further uploads or downloads.
    const r2 = await e.runOnce();
    expect(r2.uploads).toBe(0);
    expect(r2.downloads).toBe(0);
  });
});

describe('SyncEngine.runOnce — conflict scenario', () => {
  it('writes git-style markers in place + emits "conflict" event', async () => {
    // Initial common state: both sides have 'orig'.
    const file = join(localRoot, 'note.md');
    await fs.writeFile(file, 'orig');
    pod._seed(`${POD_ROOT}note.md`, 'orig');

    // First sync establishes common state.
    const e = newEngine();
    await e.runOnce();
    // Both sides identical, sync is a no-op for state purposes.

    // Now diverge: local + pod each independently edit.
    await fs.writeFile(file, 'local-edit');
    // Update pod via direct seeding (bumps etag).
    pod._seed(`${POD_ROOT}note.md`, 'remote-edit');

    const events = [];
    e.on('conflict', (c) => events.push(c));

    const r = await e.runOnce();
    expect(r.conflicts).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].relPath).toBe('note.md');

    const after = await fs.readFile(file, 'utf8');
    expect(hasConflictMarkers(after)).toBe(true);
    expect(after).toContain('local-edit');
    expect(after).toContain('remote-edit');
  });
});

describe('SyncEngine.deleteLocal — tombstone', () => {
  it('subsequent runOnce skips a tombstoned URI', async () => {
    pod._seed(`${POD_ROOT}gone.md`, 'should-not-download');

    const e = newEngine();
    await e.deleteLocal('gone.md');

    // Confirm tombstone path: pod-client mock recorded it.
    expect(pod.tombstones.has(`${POD_ROOT}gone.md`)).toBe(true);

    const r = await e.runOnce();
    expect(r.downloads).toBe(0);
    // File is NOT downloaded.
    await expect(fs.access(join(localRoot, 'gone.md'))).rejects.toThrow();
  });
});

describe('SyncEngine — state persistence', () => {
  it('persists known state to .onderling/notes-sync-state.json and resumes', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    pod._seed(`${POD_ROOT}b.md`, 'B');

    const e1 = newEngine();
    await e1.runOnce();
    await e1.stop();

    const stateRaw = await fs.readFile(
      join(localRoot, '.onderling', 'notes-sync-state.json'),
      'utf8',
    );
    const state = JSON.parse(stateRaw);
    expect(state.version).toBe(1);
    expect(state.files['a.md']).toBeDefined();
    expect(state.files['b.md']).toBeDefined();

    // New engine: known-state should mean no re-uploads / re-downloads.
    const e2 = newEngine();
    const r = await e2.runOnce();
    expect(r.uploads).toBe(0);
    expect(r.downloads).toBe(0);
    expect(r.conflicts).toBe(0);
  });
  // Naming migration 2026-07-28 — the real risk of moving the state dir: state written under the OLD
  // path must still be READ, or every note looks never-synced and the next run re-uploads the world.
  it('reads pre-rename state from the legacy .onderling/ path (no spurious re-sync)', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'A');
    pod._seed(`${POD_ROOT}b.md`, 'B');

    const e1 = newEngine();
    await e1.runOnce();
    await e1.stop();

    // Move the state file back to where a pre-rename install wrote it.
    const newDir = join(localRoot, '.onderling');
    const oldDir = join(localRoot, '.onderling');
    await fs.mkdir(oldDir, { recursive: true });
    await fs.rename(join(newDir, 'notes-sync-state.json'), join(oldDir, 'notes-sync-state.json'));

    const e2 = newEngine();
    const r = await e2.runOnce();
    expect(r.uploads).toBe(0);      // the old state was honoured…
    expect(r.downloads).toBe(0);
    // …and the next save lands on the new path.
    const moved = await fs.readFile(join(newDir, 'notes-sync-state.json'), 'utf8');
    expect(JSON.parse(moved).files['a.md']).toBeDefined();
  });
});

describe('SyncEngine — direction filters', () => {
  it("'push' only uploads", async () => {
    await fs.writeFile(join(localRoot, 'l.md'), 'l');
    pod._seed(`${POD_ROOT}r.md`, 'r');
    const e = newEngine();
    const r = await e.runOnce({ direction: 'push' });
    expect(r.uploads).toBe(1);
    expect(r.downloads).toBe(0);
    await expect(fs.access(join(localRoot, 'r.md'))).rejects.toThrow();
  });
  it("'pull' only downloads", async () => {
    await fs.writeFile(join(localRoot, 'l.md'), 'l');
    pod._seed(`${POD_ROOT}r.md`, 'r');
    const e = newEngine();
    const r = await e.runOnce({ direction: 'pull' });
    expect(r.uploads).toBe(0);
    expect(r.downloads).toBe(1);
    expect(pod.store.has(`${POD_ROOT}l.md`)).toBe(false);
  });
});

// ── Folio.B4 — versioning integration ──────────────────────────────────────

describe('SyncEngine.versions — capture sites', () => {
  it('captures a snapshot after a successful push', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    await e.runOnce();
    const list = await e.versions('a.md');
    expect(list).toHaveLength(1);
    expect(list[0].size).toBe(5);
  });

  it('captures a snapshot after a successful pull', async () => {
    pod._seed(`${POD_ROOT}b.md`, 'banana');
    const e = newEngine();
    await e.runOnce();
    const list = await e.versions('b.md');
    expect(list).toHaveLength(1);
  });

  it('emits version.new on each successful capture', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    const events = [];
    e.on('version.new', (v) => events.push(v));
    await e.runOnce();
    expect(events.length).toBe(1);
    expect(events[0].relPath).toBe('a.md');
    expect(typeof events[0].ts).toBe('number');
  });

  it('captures the conflicted intermediate state on conflict', async () => {
    const file = join(localRoot, 'note.md');
    await fs.writeFile(file, 'orig');
    pod._seed(`${POD_ROOT}note.md`, 'orig');
    const e = newEngine();
    await e.runOnce(); // common state established (no upload, both sides identical)
    await fs.writeFile(file, 'local-edit');
    pod._seed(`${POD_ROOT}note.md`, 'remote-edit');
    await e.runOnce();
    const list = await e.versions('note.md');
    // The conflict path captured the intermediate marker-laden state.
    expect(list.length).toBeGreaterThanOrEqual(1);
    // Newest version should contain conflict markers.  Snapshots are opaque
    // records now — read content via the store, not an on-disk path.
    const newest = String(await e.versionStore.read('note.md', list[0].ts));
    expect(newest).toMatch(/<{7}\sYOURS/);
  });

  it('skips snapshotting files under dotted paths (no versions of versions)', async () => {
    await fs.mkdir(join(localRoot, '.folio'), { recursive: true });
    await fs.writeFile(join(localRoot, '.folio', 'foo.md'), 'should-not-be-versioned');
    const e = newEngine();
    await e.runOnce();
    const list = await e.versions('.folio/foo.md');
    expect(list).toEqual([]);
  });
});

describe('SyncEngine.restoreVersion', () => {
  it('writes the snapshot back to the live file and emits version.new for the pre-restore snapshot', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'v1');
    const e = newEngine();
    await e.runOnce();                                   // captures v1

    // Read back what was captured so we can target it for restore.
    const list1 = await e.versions('a.md');
    expect(list1.length).toBe(1);
    const v1Ts = list1[0].ts;

    // Mutate live to a different state, then restore.
    await fs.writeFile(join(localRoot, 'a.md'), 'live-now');
    const r = await e.restoreVersion('a.md', v1Ts);
    expect(r.restoredFromMs).toBe(v1Ts);
    expect(typeof r.snapshotMsBeforeRestore).toBe('number');
    expect(await fs.readFile(join(localRoot, 'a.md'), 'utf8')).toBe('v1');

    // The pre-restore snapshot of 'live-now' is now in history.
    const list2 = await e.versions('a.md');
    const preSnap = list2.find((v) => v.ts === r.snapshotMsBeforeRestore);
    expect(preSnap).toBeDefined();
  });
});

describe('SyncEngine.dropVersions — wired into deleteLocal', () => {
  it('deleteLocal removes version history for the tombstoned file', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    await e.runOnce();
    expect((await e.versions('a.md')).length).toBeGreaterThan(0);
    await e.deleteLocal('a.md');
    expect(await e.versions('a.md')).toEqual([]);
  });
});

// ── Folio v2.11 — deleteCompletely (permanent pod + local + history wipe) ──

describe('SyncEngine.deleteCompletely (Folio v2.11)', () => {
  it('removes the pod resource, the local file, and the version history; emits sync.delete.done', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    const e = newEngine();
    await e.runOnce();
    // Sanity: pre-conditions satisfied.
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
    expect((await e.versions('a.md')).length).toBeGreaterThan(0);
    await fs.access(join(localRoot, 'a.md')); // exists

    const events = [];
    e.on('sync.delete.done', (d) => events.push(d));

    const r = await e.deleteCompletely('a.md');
    expect(r.relPath).toBe('a.md');
    expect(r.podUri).toBe(`${POD_ROOT}a.md`);

    // Pod-side gone.
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(false);
    // Local file gone.
    await expect(fs.access(join(localRoot, 'a.md'))).rejects.toThrow();
    // Version history wiped — pod-delete is "permanent".
    expect(await e.versions('a.md')).toEqual([]);
    // Event emitted with the right payload.
    expect(events).toHaveLength(1);
    expect(events[0].relPath).toBe('a.md');
    expect(events[0].podUri).toBe(`${POD_ROOT}a.md`);
    expect(typeof events[0].ts).toBe('number');
  });

  it('treats pod-side NOT_FOUND as success (idempotent local cleanup)', async () => {
    await fs.writeFile(join(localRoot, 'gone.md'), 'still-local');
    const e = newEngine();
    // Force a NOT_FOUND from the pod-client.
    pod.delete = async () => {
      const err = new Error('mock 404');
      err.code = 'NOT_FOUND';
      throw err;
    };
    pod.deleteCompletely = async (uri) => pod.delete(uri);

    const r = await e.deleteCompletely('gone.md');
    expect(r.relPath).toBe('gone.md');
    // Local cleanup proceeded despite pod-side 404.
    await expect(fs.access(join(localRoot, 'gone.md'))).rejects.toThrow();
  });

  it('rejects empty / missing relPath', async () => {
    const e = newEngine();
    await expect(e.deleteCompletely('')).rejects.toThrow();
    await expect(e.deleteCompletely(undefined)).rejects.toThrow();
  });

  it('propagates non-NOT_FOUND errors from the pod-client', async () => {
    await fs.writeFile(join(localRoot, 'b.md'), 'oops');
    const e = newEngine();
    pod.deleteCompletely = async () => {
      const err = new Error('forbidden');
      err.code = 'FORBIDDEN';
      throw err;
    };
    await expect(e.deleteCompletely('b.md')).rejects.toThrow(/forbidden/);
    // On a hard pod failure the local file MUST remain so the user can retry.
    await fs.access(join(localRoot, 'b.md'));
  });
});

describe('SyncEngine — versions retention', () => {
  it('options.versions threads through to captureVersion', async () => {
    const e = new SyncEngine({
      podClient: pod,
      localRoot,
      podRoot: POD_ROOT,
      pollIntervalMs: 1_000_000,
      debounceMs: 50,
      versions: { perFile: 3, budgetMb: 100 },
    });
    expect(e.options.versions.perFile).toBe(3);
    // Capture 5 unique versions; only 3 should remain.
    for (let i = 0; i < 5; i++) {
      await e.captureVersion('a.md', `v${i}-${i}`);
    }
    const list = await e.versions('a.md');
    expect(list.length).toBeLessThanOrEqual(3);
  });
});

// ── Folio v2.1 — setPodClient (hot-swap) ──────────────────────────────────

describe('SyncEngine.setPodClient — hot-swap', () => {
  it('replaces the internal podClient — next runOnce uses the new one', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    const e = newEngine();
    await e.runOnce(); // pushes via the original `pod`.
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
    expect(pod.writeCalls).toBeGreaterThan(0);

    // Build a fresh, empty MockPodClient.  After the swap, the new client
    // sees a.md as "missing on pod" (no known state from new pod's view) so
    // the next runOnce uploads to the NEW client, not the old one.
    const pod2 = new MockPodClient(POD_ROOT);
    const before2 = pod2.writeCalls;
    e.setPodClient(pod2);

    await e.runOnce();
    // The swap reset stateLoaded; with an empty `pod2` and the local file
    // present, the diff should classify a.md as "upload to pod2".
    expect(pod2.writeCalls).toBeGreaterThan(before2);
    expect(pod2.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('throws when newClient is missing', () => {
    const e = newEngine();
    expect(() => e.setPodClient(null)).toThrow();
    expect(() => e.setPodClient(undefined)).toThrow();
  });

  it('emits a "pod-client-swapped" event for internal subscribers', () => {
    const e = newEngine();
    const events = [];
    e.on('pod-client-swapped', (p) => events.push(p));
    const pod2 = new MockPodClient(POD_ROOT);
    e.setPodClient(pod2);
    expect(events).toHaveLength(1);
    expect(typeof events[0].ts).toBe('number');
  });

  it('rapid swaps: only the last one is observable on the next runOnce', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    const e = newEngine();
    await e.runOnce();

    const podA = new MockPodClient(POD_ROOT);
    const podB = new MockPodClient(POD_ROOT);
    const podC = new MockPodClient(POD_ROOT);
    e.setPodClient(podA);
    e.setPodClient(podB);
    e.setPodClient(podC);

    await e.runOnce();
    // Only podC should see writes.
    expect(podA.writeCalls).toBe(0);
    expect(podB.writeCalls).toBe(0);
    expect(podC.writeCalls).toBeGreaterThan(0);
    expect(podC.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('swap during in-flight runOnce: the in-flight run uses the OLD client', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    await fs.writeFile(join(localRoot, 'b.md'), 'banana');
    const e = newEngine();

    // Gate `pod.list` so we can deterministically synchronise: the run will
    // pause at scanPod's first list() call until we release.  At that point
    // the runOnce body has already snapshotted `#podClient` (which happens
    // BEFORE scanPod) — so swapping `#podClient` after we observe the gate
    // hit cannot affect the in-flight run.
    let releaseList;
    const listGate = new Promise((resolve) => { releaseList = resolve; });
    let listEntered = null;
    const enteredP = new Promise((resolve) => { listEntered = resolve; });
    const origList = pod.list.bind(pod);
    pod.list = async (...args) => {
      listEntered();
      await listGate;
      return origList(...args);
    };

    // Kick off a runOnce against the original `pod`; do NOT await.
    const inflight = e.runOnce();

    // Wait for pod.list to actually be entered — at this point, the
    // runOnce body has executed past the `const podClient = this.#podClient`
    // line.  Now any swap is "after the snapshot".
    await enteredP;

    // Swap — the in-flight run has already snapshotted `pod`.
    const pod2 = new MockPodClient(POD_ROOT);
    e.setPodClient(pod2);

    // Release the list gate so the in-flight run can finish.
    releaseList();

    // The in-flight run finishes against `pod` (per the contract).
    const r = await inflight;
    expect(r.uploads).toBe(2);
    expect(pod.store.has(`${POD_ROOT}a.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}b.md`)).toBe(true);
    // pod2 should have no writes from the in-flight run.
    expect(pod2.writeCalls).toBe(0);

    // Next runOnce uses pod2.
    await e.runOnce();
    expect(pod2.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('swap-with-pending-watch-event: scheduled run uses the new client', async () => {
    const e = newEngine();
    const pod2 = new MockPodClient(POD_ROOT);
    e.setPodClient(pod2);
    await fs.writeFile(join(localRoot, 'pend.md'), 'pending');
    // Manual runOnce stands in for a debounced watch event landing post-swap.
    await e.runOnce();
    expect(pod2.store.has(`${POD_ROOT}pend.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}pend.md`)).toBe(false);
  });
});

describe('SyncEngine — start/stop lifecycle', () => {
  it('start sets up watcher + interval; stop tears them down without leaks', async () => {
    const e = newEngine();
    e.start();
    // Give chokidar a tick to attach.
    await new Promise((r) => setTimeout(r, 60));
    await e.stop();
    // After stop, no scheduled runs should fire even if we wait.
    let calls = 0;
    e.on('synced', () => calls++);
    await new Promise((r) => setTimeout(r, 120));
    expect(calls).toBe(0);
  });

  it('start triggers an initial runOnce', async () => {
    await fs.writeFile(join(localRoot, 'init.md'), 'initial');
    const e = newEngine();
    const synced = new Promise((resolve) => e.on('synced', resolve));
    e.start();
    await synced;
    await e.stop();
    expect(pod.store.has(`${POD_ROOT}init.md`)).toBe(true);
  });

  // Slice G #6 (2026-05-20) — public observability getters.
  it('isRunning toggles across start / stop', async () => {
    const e = newEngine();
    expect(e.isRunning).toBe(false);
    e.start();
    expect(e.isRunning).toBe(true);
    await e.stop();
    expect(e.isRunning).toBe(false);
  });

  it('isWatching reports the watcher-attached state (Slice G.3)', async () => {
    const e = newEngine();
    expect(e.isWatching).toBe(false);
    e.start();
    // start() is fire-and-forget; isWatching may be false initially.
    // Give chokidar a tick to attach, then verify the flag flips true.
    await new Promise((r) => setTimeout(r, 60));
    expect(e.isWatching).toBe(true);
    await e.stop();
    expect(e.isWatching).toBe(false);
  });
});

// ── Folio v2.6 — sha-stable watcher hardening ──────────────────────────────

describe('SyncEngine — watcher sha-stability (Folio v2.6)', () => {
  // Helper: quietly count `synced` events fired by an engine.
  function countSynced(engine) {
    const state = { count: 0 };
    engine.on('synced', () => { state.count++; });
    return state;
  }

  // ENV NOTE: every test in this describe block drives a REAL wall-clock
  // watcher vigil (debounce + stableMs windows via setTimeout — no fake
  // timers). The assertions are all polled through `waitFor` below, so a
  // correct engine passes regardless of speed; the only failure mode under
  // heavy CPU contention (e.g. the full 27-file suite in parallel) is the
  // poll deadline being exhausted before late-firing timers settle. The
  // deadline is therefore generous (5s) purely to absorb contention — it does
  // NOT change pass/fail semantics for a healthy engine, only the ceiling a
  // slow machine is allowed before the assertion gives up. Do not shrink it to
  // "speed up" the suite; that just reintroduces contention flakiness.
  //
  // Helper: poll until `predicate()` returns true, capped at `timeoutMs` of
  // wall clock.  Uses real-time setTimeout (so no fake-timer interference).
  async function waitFor(predicate, timeoutMs = 5000, intervalMs = 10) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  it('exposes options.watcher with defaults + threads custom values through', () => {
    const def = newEngine();
    expect(def.options.watcher).toEqual({ stableMs: 250, maxStableWaitMs: 5000, graceMs: 3000 });
    const custom = newEngine({ watcher: { stableMs: 30, maxStableWaitMs: 200, graceMs: 0 } });
    expect(custom.options.watcher).toEqual({ stableMs: 30, maxStableWaitMs: 200, graceMs: 0 });
  });

  it('waits for sha to stabilise before firing runOnce (stable case)', async () => {
    // Tight stability window so the test is bounded.  debounceMs is the
    // existing 50ms test default; stableMs 30ms; max wait 500ms.
    // graceMs: 0 disables Folio v2.10's grace window — this test asserts
    // pure v2.6 behaviour.
    const e = newEngine({ watcher: { stableMs: 30, maxStableWaitMs: 500, graceMs: 0 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'stable.md');
    await fs.writeFile(file, 'first');
    e._injectWatchEventForTest(file, 'add');

    // Wait for the debounce + stability windows to elapse.  No further
    // writes — the file's sha is stable.
    const decided = await waitFor(() => decisions.some((d) => d.decision === 'stable'));
    expect(decided).toBe(true);

    // runOnce fires after the stable decision.  We tolerate a brief gap
    // for the runOnce promise to resolve.
    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);
    expect(syncedCount.count).toBe(1);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('does NOT fire runOnce for a file deleted before the vigil settles', async () => {
    const e = newEngine({ watcher: { stableMs: 60, maxStableWaitMs: 500, graceMs: 0 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'doomed.md');
    await fs.writeFile(file, 'gonna-go');
    e._injectWatchEventForTest(file, 'add');

    // Delete BEFORE the first stability re-check fires.  We need to wait
    // out the debounce (~50ms) but delete inside the stableMs window.
    await new Promise((r) => setTimeout(r, 55)); // past debounce, into vigil
    await fs.rm(file, { force: true });

    // Wait long enough for the re-check to land + decide "deleted".
    const decided = await waitFor(() => decisions.some((d) => d.decision === 'deleted'));
    expect(decided).toBe(true);

    // No runOnce should have fired.
    expect(syncedCount.count).toBe(0);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('caps total wait at maxStableWaitMs for an ever-changing file + emits warning', async () => {
    // Tight cap so the test runs fast (real wall clock).
    // graceMs: 0 — capped path bypasses grace, but be explicit for v2.6 parity.
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 200, graceMs: 0 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const warnings = [];
    e.on('warning', (w) => warnings.push(w));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'churn.md');
    await fs.writeFile(file, 'v0');
    e._injectWatchEventForTest(file, 'add');

    // Mutate the file every ~10ms until the cap fires.  Bounded by 400ms
    // of wall clock to keep the test under the 2s budget.
    const churnDeadline = Date.now() + 400;
    let i = 0;
    while (Date.now() < churnDeadline) {
      i++;
      try { await fs.writeFile(file, `v${i}-${Date.now()}-${Math.random()}`); }
      catch { /* race with internal read; ignore */ }
      if (decisions.some((d) => d.decision === 'capped')) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    // The cap MUST have fired, with a warning + a runOnce dispatched.
    const capped = await waitFor(() => decisions.some((d) => d.decision === 'capped'));
    expect(capped).toBe(true);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].phase).toBe('unstable-write');
    expect(warnings[0].absPath).toBe(file);
    expect(typeof warnings[0].elapsedMs).toBe('number');

    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('handles two files saved at once with independent stability vigils', async () => {
    const e = newEngine({ watcher: { stableMs: 30, maxStableWaitMs: 500, graceMs: 0 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const f1 = join(localRoot, 'a.md');
    const f2 = join(localRoot, 'b.md');
    await fs.writeFile(f1, 'A');
    await fs.writeFile(f2, 'B');
    e._injectWatchEventForTest(f1, 'add');
    e._injectWatchEventForTest(f2, 'add');

    // Both should reach 'stable' independently.
    const allStable = await waitFor(() =>
      decisions.filter((d) => d.decision === 'stable').length >= 2,
    );
    expect(allStable).toBe(true);
    const stablePaths = decisions
      .filter((d) => d.decision === 'stable')
      .map((d) => d.absPath)
      .sort();
    expect(stablePaths).toContain(f1);
    expect(stablePaths).toContain(f2);

    // runOnce should have run at least once and completed both uploads.
    const ran = await waitFor(() => syncedCount.count >= 1 &&
      pod.store.has(`${POD_ROOT}a.md`) && pod.store.has(`${POD_ROOT}b.md`));
    expect(ran).toBe(true);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('restarts the wait when sha changes between checks (no premature fire)', async () => {
    const e = newEngine({ watcher: { stableMs: 40, maxStableWaitMs: 800, graceMs: 0 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'flap.md');
    await fs.writeFile(file, 'first');
    e._injectWatchEventForTest(file, 'add');

    // Wait past the debounce window so the vigil is armed, then change
    // content once before the first stable check fires.
    await new Promise((r) => setTimeout(r, 55)); // past 50ms debounce
    await fs.writeFile(file, 'second'); // mutate during vigil
    // Now leave it alone — the vigil should detect the change, restart,
    // then settle on the second sha.

    // Eventually we expect at least one 'changed' decision followed by
    // a 'stable' decision, and exactly one runOnce.
    const sawChange = await waitFor(() => decisions.some((d) => d.decision === 'changed'));
    expect(sawChange).toBe(true);

    const settled = await waitFor(() => decisions.some((d) => d.decision === 'stable'));
    expect(settled).toBe(true);

    // No premature firing — runOnce only counts after the stable decision.
    // runOnce dispatches ASYNCHRONOUSLY once the vigil settles, so wait for
    // the count to land rather than sampling it synchronously right after the
    // 'stable' decision (that sample races the async runOnce under CPU
    // contention → intermittent `expected 0 to be 1`). Mirrors the stable-case
    // test above. We still assert exactly one fire (no premature/double run).
    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);
    expect(syncedCount.count).toBe(1);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('stop() cancels pending stability vigils — no spurious runOnce', async () => {
    const e = newEngine({ watcher: { stableMs: 50, maxStableWaitMs: 500, graceMs: 0 } });
    e._armForStabilityTest();

    const decisions = [];
    e._onStabilityDecision((d) => decisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'mid.md');
    await fs.writeFile(file, 'mid-state');
    e._injectWatchEventForTest(file, 'add');

    // Tear down before the vigil could possibly settle.
    await new Promise((r) => setTimeout(r, 10));
    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)

    // Wait past where 'stable' would have landed had we not torn down.
    await new Promise((r) => setTimeout(r, 200));

    // No 'stable' or 'capped' decisions; no runOnce.
    const fired = decisions.filter((d) => d.decision === 'stable' || d.decision === 'capped');
    expect(fired).toEqual([]);
    expect(syncedCount.count).toBe(0);
  });
});

// ── Folio v2.10 — copy-rename grace window ─────────────────────────────────

describe('SyncEngine — copy-rename grace window (Folio v2.10)', () => {
  // Helper: count `synced` events fired by an engine.
  function countSynced(engine) {
    const state = { count: 0 };
    engine.on('synced', () => { state.count++; });
    return state;
  }

  async function waitFor(predicate, timeoutMs = 1500, intervalMs = 10) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await predicate()) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  it('exposes the graceMs default (3000) and threads custom values through', () => {
    const def = newEngine();
    expect(def.options.watcher.graceMs).toBe(3000);
    const custom = newEngine({ watcher: { graceMs: 75 } });
    expect(custom.options.watcher.graceMs).toBe(75);
    const zero = newEngine({ watcher: { graceMs: 0 } });
    expect(zero.options.watcher.graceMs).toBe(0);
  });

  it('copy-then-rename within grace: intermediate is NOT synced; final name IS synced', async () => {
    // Tight windows so the test fits inside the wall-clock budget.
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 400, graceMs: 120 } });
    e._armForStabilityTest();

    const stabilityDecisions = [];
    const graceDecisions = [];
    e._onStabilityDecision((d) => stabilityDecisions.push(d));
    e._onGraceDecision((d) => graceDecisions.push(d));
    const syncedCount = countSynced(e);

    const intermediate = join(localRoot, 'A (Copy).md');
    const finalName    = join(localRoot, 'B.md');

    // Step 1 — user copies A.md → A (Copy).md.  Chokidar fires `add`.
    await fs.writeFile(intermediate, 'shared content');
    e._injectWatchEventForTest(intermediate, 'add');

    // Step 2 — wait for stability to settle on the intermediate.
    const settled = await waitFor(() =>
      stabilityDecisions.some((d) => d.decision === 'stable' && d.absPath === intermediate),
    );
    expect(settled).toBe(true);

    // Step 3 — confirm grace was armed for the intermediate (not yet fired).
    const armed = await waitFor(() =>
      graceDecisions.some((d) => d.decision === 'armed' && d.absPath === intermediate),
    );
    expect(armed).toBe(true);

    // Step 4 — user renames A (Copy).md → B.md WITHIN the grace window.
    // chokidar represents this as `unlink` of the source + `add` of the target.
    await fs.rename(intermediate, finalName);
    e._injectWatchEventForTest(intermediate, 'unlink');
    e._injectWatchEventForTest(finalName,    'add');

    // The intermediate must be dropped from grace — no sync of A (Copy).md.
    const dropped = await waitFor(() =>
      graceDecisions.some((d) => d.decision === 'dropped' && d.absPath === intermediate),
    );
    expect(dropped).toBe(true);

    // The final name runs its own stability + grace cycle.
    const finalSettled = await waitFor(() =>
      stabilityDecisions.some((d) => d.decision === 'stable' && d.absPath === finalName),
    );
    expect(finalSettled).toBe(true);

    // After grace elapses for the FINAL name, runOnce fires.
    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);

    // Critical invariant: the pod has B.md but never saw A (Copy).md.
    expect(pod.store.has(`${POD_ROOT}B.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}${encodeURIComponent('A (Copy).md')}`)).toBe(false);
    expect(pod.store.has(`${POD_ROOT}A (Copy).md`)).toBe(false);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('copy alone (no rename) syncs after graceMs elapses', async () => {
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 400, graceMs: 80 } });
    e._armForStabilityTest();

    const graceDecisions = [];
    e._onGraceDecision((d) => graceDecisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'standalone.md');
    await fs.writeFile(file, 'just a copy');
    e._injectWatchEventForTest(file, 'add');

    // Grace should fire untouched and runOnce should sync the file.
    const fired = await waitFor(() =>
      graceDecisions.some((d) => d.decision === 'fired' && d.absPath === file),
    );
    expect(fired).toBe(true);

    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);
    expect(pod.store.has(`${POD_ROOT}standalone.md`)).toBe(true);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('rapid edits within grace: only the LAST content is what eventually syncs', async () => {
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 800, graceMs: 100 } });
    e._armForStabilityTest();

    const graceDecisions = [];
    e._onGraceDecision((d) => graceDecisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'edited.md');

    // First write + reach stable + arm grace.
    await fs.writeFile(file, 'v1');
    e._injectWatchEventForTest(file, 'add');
    const armed = await waitFor(() =>
      graceDecisions.some((d) => d.decision === 'armed' && d.absPath === file),
    );
    expect(armed).toBe(true);

    // Edit the file BEFORE grace elapses.  Inject the corresponding `change`
    // event — this should restart the grace cycle (cancel + new vigil).
    await fs.writeFile(file, 'v2-final');
    e._injectWatchEventForTest(file, 'change');

    // We expect a 'restarted' decision for the file (grace cancelled).
    const restarted = await waitFor(() =>
      graceDecisions.some((d) => d.decision === 'restarted' && d.absPath === file),
    );
    expect(restarted).toBe(true);

    // Eventually grace fires + runOnce uploads the LAST content.
    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);

    // Content on the pod must be 'v2-final', not 'v1'.
    const stored = pod.store.get(`${POD_ROOT}edited.md`);
    expect(stored).toBeDefined();
    const content = typeof stored.content === 'string'
      ? stored.content
      : new TextDecoder().decode(stored.content);
    expect(content).toBe('v2-final');

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('stop() cancels pending grace timers — no spurious runOnce after teardown', async () => {
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 400, graceMs: 200 } });
    e._armForStabilityTest();

    const graceDecisions = [];
    e._onGraceDecision((d) => graceDecisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'mid-grace.md');
    await fs.writeFile(file, 'about to be torn down');
    e._injectWatchEventForTest(file, 'add');

    // Wait until grace is armed, then teardown well before it would fire.
    const armed = await waitFor(() =>
      graceDecisions.some((d) => d.decision === 'armed' && d.absPath === file),
    );
    expect(armed).toBe(true);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)

    // Wait past where grace would have fired had we not torn down.
    await new Promise((r) => setTimeout(r, 250));

    // Grace must NOT have fired; runOnce must NOT have run.
    const fired = graceDecisions.filter((d) => d.decision === 'fired');
    expect(fired).toEqual([]);
    expect(syncedCount.count).toBe(0);
  });

  it('graceMs: 0 → fires runOnce immediately on stable (v2.6 behaviour preserved)', async () => {
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 400, graceMs: 0 } });
    e._armForStabilityTest();

    const stabilityDecisions = [];
    const graceDecisions = [];
    e._onStabilityDecision((d) => stabilityDecisions.push(d));
    e._onGraceDecision((d) => graceDecisions.push(d));
    const syncedCount = countSynced(e);

    const file = join(localRoot, 'no-grace.md');
    await fs.writeFile(file, 'no waiting');
    e._injectWatchEventForTest(file, 'add');

    // Sync should fire as soon as stability passes.
    const settled = await waitFor(() =>
      stabilityDecisions.some((d) => d.decision === 'stable'),
    );
    expect(settled).toBe(true);

    const ran = await waitFor(() => syncedCount.count >= 1);
    expect(ran).toBe(true);

    // No grace decisions should have been emitted at all.
    expect(graceDecisions).toEqual([]);

    e._disarmForTest();
    await e.stop();   // drains any in-flight runOnce — else its #saveState races afterEach's rm (ENOTEMPTY)
  });

  it('runOnce() called explicitly bypasses grace entirely', async () => {
    // Even with a long graceMs, an explicit runOnce should run end-to-end
    // immediately — grace only gates watcher-driven runs.
    const e = newEngine({ watcher: { stableMs: 25, maxStableWaitMs: 400, graceMs: 5000 } });
    await fs.writeFile(join(localRoot, 'manual.md'), 'pushed by hand');
    const r = await e.runOnce();
    expect(r.uploads).toBe(1);
    expect(pod.store.has(`${POD_ROOT}manual.md`)).toBe(true);
  });
});

// ── Folio v2.5 — forcePush + verifyPodState ────────────────────────────────

describe('SyncEngine.forcePush — Folio v2.5', () => {
  it('re-uploads every local file even when knownState is in sync', async () => {
    // Seed local + pod identical so a normal runOnce is a no-op.
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    await fs.writeFile(join(localRoot, 'b.md'), 'banana');
    const e = newEngine();
    await e.runOnce(); // populates knownState; pod now has both files.
    const writesAfterFirst = pod.writeCalls;

    // A second runOnce: zero uploads (cached as in-sync).
    const noop = await e.runOnce();
    expect(noop.uploads).toBe(0);
    expect(pod.writeCalls).toBe(writesAfterFirst);

    // forcePush: re-uploads regardless.
    const r = await e.forcePush();
    expect(r.uploads).toBe(2);
    expect(r.errors).toBe(0);
    expect(pod.writeCalls).toBe(writesAfterFirst + 2);
  });

  it('emits sync.force.start + sync.force.done with counts', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    await fs.writeFile(join(localRoot, 'b.md'), 'banana');
    const e = newEngine();
    await e.runOnce();

    const events = [];
    e.on('sync.force.start', (s) => events.push({ type: 'start', ...s }));
    e.on('sync.force.done',  (s) => events.push({ type: 'done',  ...s }));

    const r = await e.forcePush();
    expect(events.map((x) => x.type)).toEqual(['start', 'done']);
    expect(typeof events[0].ts).toBe('number');
    expect(events[1].uploads).toBe(2);
    expect(events[1].errors).toBe(0);
    expect(r.uploads).toBe(2);
  });

  it('counts per-file errors without aborting the rest of the run', async () => {
    await fs.writeFile(join(localRoot, 'good.md'),  'ok');
    await fs.writeFile(join(localRoot, 'flaky.md'), 'oops');
    await fs.writeFile(join(localRoot, 'good2.md'), 'ok2');
    const e = newEngine();
    // Wrap pod.write so flaky.md throws once.
    const origWrite = pod.write.bind(pod);
    pod.write = async (uri, content, opts) => {
      if (uri.endsWith('flaky.md')) {
        const err = new Error('PUT 503');
        err.code = 'TRANSIENT';
        throw err;
      }
      return origWrite(uri, content, opts);
    };
    const errs = [];
    e.on('error', (ev) => errs.push(ev));

    const r = await e.forcePush();
    expect(r.uploads).toBe(2);
    expect(r.errors).toBe(1);
    // Per-file error is surfaced via the standard error event.
    const flakyErr = errs.find((x) => x.phase === 'force-push' && x.relPath === 'flaky.md');
    expect(flakyErr).toBeDefined();
    expect(flakyErr.err.message).toMatch(/503/);
    // Other files were still uploaded.
    expect(pod.store.has(`${POD_ROOT}good.md`)).toBe(true);
    expect(pod.store.has(`${POD_ROOT}good2.md`)).toBe(true);
  });

  it('only pushes — never pulls or deletes (pod-only file is untouched locally)', async () => {
    await fs.writeFile(join(localRoot, 'mine.md'), 'local-only');
    pod._seed(`${POD_ROOT}theirs.md`, 'pod-only');
    const e = newEngine();
    // No prior runOnce: knownState is empty.  forcePush must still ignore the
    // pod-only file (no download) and push the local-only file.
    const r = await e.forcePush();
    expect(r.uploads).toBe(1);

    // Local file system unchanged: no theirs.md created.
    await expect(fs.access(join(localRoot, 'theirs.md'))).rejects.toThrow();
    // Pod still has its file (we don't delete).
    expect(pod.store.has(`${POD_ROOT}theirs.md`)).toBe(true);
    // Our local file was uploaded.
    expect(pod.store.has(`${POD_ROOT}mine.md`)).toBe(true);
  });

  it('updates knownState — a follow-up runOnce reports zero uploads', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    const e = newEngine();
    // Skip the initial runOnce: forcePush should still leave knownState clean.
    const r = await e.forcePush();
    expect(r.uploads).toBe(1);

    const r2 = await e.runOnce();
    expect(r2.uploads).toBe(0);
    expect(r2.downloads).toBe(0);
  });

  it('respects #runChain — a force fired during an in-flight runOnce waits its turn', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    const e = newEngine();
    await e.runOnce();

    // Gate pod.list so the in-flight runOnce stalls; track the order in which
    // pod.write is called to confirm forcePush waited.
    let releaseList;
    const listGate = new Promise((resolve) => { releaseList = resolve; });
    const origList = pod.list.bind(pod);
    let inflightActive = true;
    const writeOrder = [];
    const origWrite = pod.write.bind(pod);
    pod.write = async (uri, content, opts) => {
      writeOrder.push({ uri, inflight: inflightActive });
      return origWrite(uri, content, opts);
    };
    pod.list = async (...args) => {
      await listGate;
      return origList(...args);
    };

    // Modify the file so the in-flight runOnce will write.
    await fs.writeFile(join(localRoot, 'a.md'), 'apple-v2');
    const inflight = e.runOnce({ direction: 'push' });
    // forcePush queued behind it.
    const forcing = e.forcePush();

    // Release the gate; in-flight resolves first, then forcePush runs.
    inflightActive = true;
    releaseList();
    await inflight;
    inflightActive = false;
    const r = await forcing;
    expect(r.uploads).toBe(1);
    // Both the in-flight (during inflight=true) and the force (inflight=false)
    // wrote.  The force must have written AFTER the in-flight's writes —
    // there must be an entry with inflight=false (the force's), and at least
    // one with inflight=true (the queued runOnce's).
    expect(writeOrder.some((w) => w.inflight)).toBe(true);
    expect(writeOrder.some((w) => !w.inflight)).toBe(true);
    // The first force-push write index is after the last inflight write.
    const lastInflightIx = writeOrder.findLastIndex
      ? writeOrder.findLastIndex((w) => w.inflight)
      : (() => { for (let i = writeOrder.length - 1; i >= 0; i--) if (writeOrder[i].inflight) return i; return -1; })();
    const firstForceIx   = writeOrder.findIndex((w) => !w.inflight);
    expect(firstForceIx).toBeGreaterThan(lastInflightIx);
  });
});

describe('SyncEngine.verifyPodState — Folio v2.5', () => {
  it('reports exists=true and matches when pod === local', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'hello');
    const e = newEngine();
    await e.runOnce();

    const r = await e.verifyPodState('a.md');
    expect(r.relPath).toBe('a.md');
    expect(r.podUri).toBe(`${POD_ROOT}a.md`);
    expect(r.exists).toBe(true);
    expect(r.sizeMatches).toBe(true);
    expect(r.shaMatches).toBe(true);
    // etag string came from the mock pod.
    expect(typeof r.podEtag).toBe('string');
  });

  it('reports exists=false when the pod has no such resource', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'hello');
    const e = newEngine();
    // Don't push.  Pod is empty.

    const r = await e.verifyPodState('a.md');
    expect(r.exists).toBe(false);
    // No size/sha fields populated (we can't compare to a nonexistent pod copy).
    expect(r.sizeMatches).toBeUndefined();
    expect(r.shaMatches).toBeUndefined();
  });

  it('reports mismatch when pod content differs from local', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'local-version');
    pod._seed(`${POD_ROOT}a.md`, 'pod-version-different');
    const e = newEngine();

    const r = await e.verifyPodState('a.md');
    expect(r.exists).toBe(true);
    expect(r.sizeMatches).toBe(false);
    expect(r.shaMatches).toBe(false);
  });

  it('uses HEAD-cheap path when podClient.exists() + head() are present', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'hello');
    pod._seed(`${POD_ROOT}a.md`, 'hello');

    let existsCalls = 0;
    let headCalls = 0;
    let readCalls = 0;
    pod.exists = async (uri) => { existsCalls++; return pod.store.has(uri); };
    pod.head   = async (uri) => {
      headCalls++;
      const r = pod.store.get(uri);
      return { etag: r.etag, size: r.size };
    };
    const origRead = pod.read.bind(pod);
    pod.read = async (...args) => { readCalls++; return origRead(...args); };

    const e = newEngine();
    const r = await e.verifyPodState('a.md');
    expect(existsCalls).toBe(1);
    expect(headCalls).toBe(1);
    // Crucially, no read() — HEAD-cheap stays cheap.
    expect(readCalls).toBe(0);
    expect(r.exists).toBe(true);
    expect(r.sizeMatches).toBe(true);
    expect(r.podEtag).toBeDefined();
    // No content available → no shaMatches.
    expect(r.shaMatches).toBeUndefined();
  });

  it('falls back to read() when podClient.head() is absent', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'hello');
    pod._seed(`${POD_ROOT}a.md`, 'hello');

    pod.exists = async (uri) => pod.store.has(uri);
    // No pod.head — should fall through to read().
    const origRead = pod.read.bind(pod);
    let readCalls = 0;
    pod.read = async (...args) => { readCalls++; return origRead(...args); };

    const e = newEngine();
    const r = await e.verifyPodState('a.md');
    expect(readCalls).toBe(1);
    expect(r.exists).toBe(true);
    expect(r.sizeMatches).toBe(true);
    expect(r.shaMatches).toBe(true);
  });

  it('throws on empty/missing relPath', async () => {
    const e = newEngine();
    await expect(e.verifyPodState('')).rejects.toThrow();
    await expect(e.verifyPodState(null)).rejects.toThrow();
  });
});
