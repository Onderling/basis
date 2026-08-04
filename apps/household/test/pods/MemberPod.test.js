/**
 * MemberPod.test.js — Phase 2 Stream 2d.
 *
 * Drives `MemberPod` against an in-test `MockPodClient` that mimics
 * just enough of `@onderling/pod-client.PodClient` to verify the
 * collection-file storage convention + the addItem→ItemRef contract.
 *
 * The mock pod is a flat URI→{ content, contentType } map with a
 * `NOT_FOUND` shape on missing reads — the same code path the real
 * pod-client surfaces via `mapSourceCode('NOT_FOUND', …)`.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { MemberPod, MEMBER_TYPE_TO_FILE } from '../../src/pods/MemberPod.js';

// ── In-test mock pod client ─────────────────────────────────────────────
// Mirrors only the surface MemberPod uses: read / write.  Content is
// stored decoded (objects) when the caller passes an object — matching
// PodClient's `decode: 'json'` semantics.

class MockPodClient {
  constructor() {
    /** @type {Map<string, { content: any, contentType: string }>} */
    this.store = new Map();
    this.reads  = [];
    this.writes = [];
  }
  async read(uri /*, opts */) {
    this.reads.push(uri);
    if (!this.store.has(uri)) {
      const err = new Error(`MockPodClient: not found: ${uri}`);
      // @ts-ignore add a code field like the real pod-client error
      err.code = 'NOT_FOUND';
      throw err;
    }
    const e = this.store.get(uri);
    return { content: e.content, contentType: e.contentType };
  }
  async write(uri, content, opts = {}) {
    this.writes.push({ uri, content, opts });
    // Match PodClient: objects are JSON-encoded by the real client; we
    // just store the parsed object so reads return parity with
    // `decode: 'json'`.
    this.store.set(uri, {
      content,
      contentType: opts.contentType || 'application/json',
    });
    return { uri };
  }
}

const POD_ROOT = 'https://pod.example.com/anne/';
const WEBID    = 'https://id.inrupt.com/anne';

function mkItem(overrides = {}) {
  // Rich task shape: `assignee` for the owner; open items simply omit
  // `completedAt` (a done item passes it explicitly via overrides).
  return {
    id:          'ulid-1',
    type:        'errand',
    text:        'pick up the dry cleaning',
    addedBy:     WEBID,
    addedAt:     1_700_000_000_000,
    assignee:    WEBID,
    source:      { tg: { chatId: 'c1', messageId: 'm1' } },
    ...overrides,
  };
}

describe('MemberPod', () => {
  /** @type {MockPodClient} */
  let pod;
  /** @type {MemberPod} */
  let member;

  beforeEach(() => {
    pod = new MockPodClient();
    member = new MemberPod({ podClient: pod, podRoot: POD_ROOT, memberWebid: WEBID });
  });

  // ── construction ──────────────────────────────────────────────────────

  it('throws if required args are missing', () => {
    expect(() => new MemberPod({})).toThrow();
    expect(() => new MemberPod({ podClient: pod })).toThrow();
    expect(() => new MemberPod({ podClient: pod, podRoot: POD_ROOT })).toThrow(/memberWebid/);
  });

  it('normalises podRoot with a trailing slash', () => {
    const m = new MemberPod({
      podClient: pod,
      podRoot: 'https://pod.example.com/anne',
      memberWebid: WEBID,
    });
    expect(m.podRoot).toBe('https://pod.example.com/anne/');
  });

  // ── addItem ───────────────────────────────────────────────────────────

  it('addItem writes errand items to /private/errands.json', async () => {
    const item = mkItem({ type: 'errand' });
    const { uri, relPath } = await member.addItem(item);

    expect(relPath).toBe('private/errands.json');
    expect(uri).toBe(`${POD_ROOT}private/errands.json`);
    expect(pod.store.get(uri).content).toEqual([item]);
    expect(pod.store.get(uri).contentType).toBe('application/json');
  });

  it('addItem writes schedule items to /private/schedule.json', async () => {
    const item = mkItem({ id: 'ulid-sched', type: 'schedule', text: 'dentist' });
    const { uri, relPath } = await member.addItem(item);

    expect(relPath).toBe('private/schedule.json');
    expect(uri).toBe(`${POD_ROOT}private/schedule.json`);
    expect(pod.store.get(uri).content).toEqual([item]);
  });

  it('addItem appends to an existing collection without overwriting prior items', async () => {
    const a = mkItem({ id: 'ulid-a', type: 'errand', addedAt: 1 });
    const b = mkItem({ id: 'ulid-b', type: 'errand', addedAt: 2 });
    await member.addItem(a);
    await member.addItem(b);

    const stored = pod.store.get(`${POD_ROOT}private/errands.json`).content;
    expect(stored).toEqual([a, b]);
  });

  it('addItem is idempotent on duplicate ids — last write wins', async () => {
    const v1 = mkItem({ id: 'ulid-a', text: 'first' });
    const v2 = mkItem({ id: 'ulid-a', text: 'second (revised)' });
    await member.addItem(v1);
    await member.addItem(v2);
    const stored = pod.store.get(`${POD_ROOT}private/errands.json`).content;
    expect(stored).toHaveLength(1);
    expect(stored[0].text).toBe('second (revised)');
  });

  it('addItem accepts items missing optional fields (no dueAt) without breaking', async () => {
    const item = mkItem();
    delete item.dueAt; // explicitly absent
    const { relPath } = await member.addItem(item);
    expect(relPath).toBe('private/errands.json');
    const stored = pod.store.get(`${POD_ROOT}private/errands.json`).content;
    expect(stored[0]).toEqual(item);
    expect(stored[0]).not.toHaveProperty('dueAt');
  });

  it('addItem rejects unknown ItemTypes (only errand+schedule live on member pods)', async () => {
    await expect(
      member.addItem(mkItem({ id: 'x', type: 'shopping' })),
    ).rejects.toThrow(/not stored on member pods/);
    await expect(
      member.addItem(mkItem({ id: 'y', type: 'repair' })),
    ).rejects.toThrow(/not stored on member pods/);
  });

  // ── listOpen ──────────────────────────────────────────────────────────

  it('listOpen returns [] when the pod is empty (NOT_FOUND treated as empty collection)', async () => {
    const open = await member.listOpen();
    expect(open).toEqual([]);
  });

  it('listOpen merges errands+schedule by default and filters by type when asked', async () => {
    const e1 = mkItem({ id: 'e1', type: 'errand', addedAt: 10 });
    const s1 = mkItem({ id: 's1', type: 'schedule', addedAt: 5 });
    const s2 = mkItem({ id: 's2', type: 'schedule', addedAt: 20 });
    await member.addItem(e1);
    await member.addItem(s1);
    await member.addItem(s2);

    const all = await member.listOpen();
    // sorted by addedAt ASC: s1(5), e1(10), s2(20)
    expect(all.map((it) => it.id)).toEqual(['s1', 'e1', 's2']);

    const onlySchedule = await member.listOpen({ type: 'schedule' });
    expect(onlySchedule.map((it) => it.id)).toEqual(['s1', 's2']);

    const onlyErrand = await member.listOpen({ type: 'errand' });
    expect(onlyErrand.map((it) => it.id)).toEqual(['e1']);
  });

  it('listOpen excludes completed items', async () => {
    const open  = mkItem({ id: 'open' });
    const done  = mkItem({ id: 'done',  completedAt: 1_700_000_001_000 });
    await member.addItem(open);
    await member.addItem(done);

    const out = await member.listOpen();
    expect(out.map((it) => it.id)).toEqual(['open']);
  });

  // ── getById ───────────────────────────────────────────────────────────

  it('getById returns null when the id is missing', async () => {
    expect(await member.getById('nope')).toBeNull();

    await member.addItem(mkItem({ id: 'something-else' }));
    expect(await member.getById('still-nope')).toBeNull();
  });

  it('getById returns the right item across collections', async () => {
    const e = mkItem({ id: 'e1', type: 'errand', text: 'errand text' });
    const s = mkItem({ id: 's1', type: 'schedule', text: 'schedule text' });
    await member.addItem(e);
    await member.addItem(s);

    expect((await member.getById('e1')).text).toBe('errand text');
    expect((await member.getById('s1')).text).toBe('schedule text');
  });

  // ── markComplete ──────────────────────────────────────────────────────

  it('markComplete sets completedAt in-place and keeps the item in the collection', async () => {
    const item = mkItem({ id: 'mc-1' });
    await member.addItem(item);

    const before = Date.now();
    const updated = await member.markComplete('mc-1');
    const after = Date.now();

    expect(updated.completedAt).toBeGreaterThanOrEqual(before);
    expect(updated.completedAt).toBeLessThanOrEqual(after);

    // Still on disk in the same collection (member's own client decides
    // when to prune).
    const stored = pod.store.get(`${POD_ROOT}private/errands.json`).content;
    expect(stored).toHaveLength(1);
    expect(stored[0].completedAt).toBe(updated.completedAt);
    expect(stored[0].id).toBe('mc-1');
  });

  it('markComplete throws on unknown id', async () => {
    await expect(member.markComplete('does-not-exist')).rejects.toThrow(/not found/);
  });

  // ── remove ────────────────────────────────────────────────────────────

  it('remove deletes from the collection but leaves siblings alone', async () => {
    const a = mkItem({ id: 'a' });
    const b = mkItem({ id: 'b' });
    await member.addItem(a);
    await member.addItem(b);

    await member.remove('a');

    const stored = pod.store.get(`${POD_ROOT}private/errands.json`).content;
    expect(stored.map((it) => it.id)).toEqual(['b']);
  });

  it('remove is a no-op on unknown id (idempotent)', async () => {
    await member.addItem(mkItem({ id: 'a' }));
    await expect(member.remove('does-not-exist')).resolves.toBeUndefined();
    const stored = pod.store.get(`${POD_ROOT}private/errands.json`).content;
    expect(stored.map((it) => it.id)).toEqual(['a']);
  });

  // ── exposed map ───────────────────────────────────────────────────────

  it('MEMBER_TYPE_TO_FILE locks the per-type filenames', () => {
    expect(MEMBER_TYPE_TO_FILE).toEqual({
      errand:   'errands.json',
      schedule: 'schedule.json',
    });
    // It's frozen so a typo elsewhere can't silently rewrite it.
    expect(Object.isFrozen(MEMBER_TYPE_TO_FILE)).toBe(true);
  });

  it('MemberPod.COLLECTION_RELPATHS exposes the relPaths under /private/', () => {
    expect([...MemberPod.COLLECTION_RELPATHS].sort()).toEqual([
      'private/errands.json',
      'private/schedule.json',
    ]);
  });
});
