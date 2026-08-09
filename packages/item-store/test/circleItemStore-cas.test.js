/**
 * PLAN-capabilities-tasks-roles (Option A) — CircleItemStore's CAS write path.
 *
 * `CircleItemStore.putIfMatch` is the AUTHORITATIVE single-writer path
 * (claim / reassign / approve): an `If-Match: <etag>` precondition makes a
 * concurrent second writer lose deterministically (exactly one winner + one
 * `{error:'conflict', current}`), reusing the DataSource-level etag mechanism
 * `ItemStore.claim` already uses. The causal `put` path (replicated content)
 * is left untouched — asserted here too.
 */
import { describe, it, expect } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { MemorySource } from '@onderling/core';

const ROOT = 'pod://circle/';
const uriOf = (id) => `${ROOT}items/${id}.json`;

/** A CAS-capable "central pod": per-path etag + If-Match enforcement. */
function makeCasPodSource() {
  const store = new Map();
  let seq = 0;
  const nextEtag = () => `"etag-${++seq}"`;
  return {
    async read(path) { return store.get(path)?.data ?? null; },
    async readEtag(path) { return store.get(path)?.etag ?? null; },
    async write(path, data, opts = {}) {
      const cur = store.get(path);
      if (opts && opts.ifMatch != null && (cur?.etag ?? null) !== opts.ifMatch) {
        throw Object.assign(new Error('If-Match failed'), { code: 'CONFLICT', status: 412 });
      }
      const etag = nextEtag();
      store.set(path, { data, etag });
      return { etag };
    },
    async delete(path) { store.delete(path); },
    async list(prefix = '') { return [...store.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}

describe('CircleItemStore.putIfMatch — CAS authoritative write (Option A)', () => {
  it('CAS write succeeds on a fresh item (no prior version to guard)', async () => {
    const pod = makeCasPodSource();
    const store = new CircleItemStore({ dataSource: pod, rootContainer: ROOT });

    const res = await store.putIfMatch({ type: 'task', id: 't1', text: 'fix the tap' }, { by: 'alice' });
    expect(res.error).toBeUndefined();
    expect(res.id).toBe('t1');
    expect(res.text).toBe('fix the tap');
    expect(res.updatedBy).toBe('alice');

    // The pod holds exactly the written item.
    const raw = await pod.read(uriOf('t1'));
    expect(JSON.parse(raw).text).toBe('fix the tap');
  });

  it('two concurrent CAS writes on the SAME base etag → exactly one wins, the other conflicts', async () => {
    const pod = makeCasPodSource();
    const alice = new CircleItemStore({ dataSource: pod, rootContainer: ROOT });
    const bob   = new CircleItemStore({ dataSource: pod, rootContainer: ROOT });

    // Seed an unclaimed task; capture the etag both racers observed.
    await alice.putIfMatch({ type: 'task', id: 'shared', text: 'shared', assignee: null }, { by: 'sys' });
    const baseEtag = await pod.readEtag(uriOf('shared'));

    // Both race off the SAME base etag (the genuine distributed race).
    const aliceRes = await alice.putIfMatch(
      { type: 'task', id: 'shared', text: 'shared', assignee: 'alice' },
      { by: 'alice', expectedEtag: baseEtag },
    );
    const bobRes = await bob.putIfMatch(
      { type: 'task', id: 'shared', text: 'shared', assignee: 'bob' },
      { by: 'bob', expectedEtag: baseEtag },
    );

    // Exactly one winner; the loser gets the structured conflict + the winner.
    expect(aliceRes.error).toBeUndefined();
    expect(aliceRes.assignee).toBe('alice');
    expect(bobRes.error).toBe('conflict');
    expect(bobRes.current.assignee).toBe('alice');

    // The pod holds exactly one winner.
    const raw = await pod.read(uriOf('shared'));
    expect(JSON.parse(raw).assignee).toBe('alice');
  });

  it('a successful CAS write fans out via the sync hook (unless inbound)', async () => {
    const pod = makeCasPodSource();
    const emitted = [];
    const store = new CircleItemStore({ dataSource: pod, rootContainer: ROOT });
    store.setSyncHook({ publishItem: (it) => emitted.push(it.id) });

    await store.putIfMatch({ type: 'task', id: 'a', text: 'x' }, { by: 'u' });
    expect(emitted).toEqual(['a']);

    // `sync:false` (inbound) suppresses the fan-out, matching put().
    await store.putIfMatch({ type: 'task', id: 'b', text: 'y' }, { by: 'u', sync: false });
    expect(emitted).toEqual(['a']);
  });

  it('non-CAS DataSource (MemorySource) — documented fallback: guarded write, no conflict surfaced', async () => {
    const mem = new MemorySource();
    const store = new CircleItemStore({ dataSource: mem, rootContainer: ROOT });

    const first = await store.putIfMatch({ type: 'task', id: 't', text: 'v1', assignee: 'alice' }, { by: 'alice' });
    expect(first.error).toBeUndefined();
    expect(first.assignee).toBe('alice');

    // No etag support → last-write-wins, no conflict result (weaker guarantee).
    const second = await store.putIfMatch({ type: 'task', id: 't', text: 'v2', assignee: 'bob' }, { by: 'bob' });
    expect(second.error).toBeUndefined();
    expect(second.assignee).toBe('bob');

    const final = await store.get('t');
    expect(final.assignee).toBe('bob');
  });

  it('the causal put() path is unchanged — a causally-older inbound is still dropped', async () => {
    const mem = new MemorySource();
    const store = new CircleItemStore({ dataSource: mem, rootContainer: ROOT });

    // Newer local edit lands first (higher Lamport clock).
    await store.put(
      { type: 'task', id: 'c', text: 'newer', clock: 2, updatedBy: 'a' },
      { origin: true },
    );
    // A causally-OLDER inbound (lower clock) must NOT overwrite it (causalWinner keeps local).
    const res = await store.put(
      { type: 'task', id: 'c', text: 'older', clock: 1, updatedBy: 'b' },
      { origin: true },
    );
    expect(res.text).toBe('newer');
    expect((await store.get('c')).text).toBe('newer');
  });
});
