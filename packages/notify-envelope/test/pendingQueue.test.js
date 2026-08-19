/**
 * pendingQueue — enqueue / list / drain semantics.
 *
 * Backed by a real MemoryBackend so the wire shape matches what
 * the substrate uses in production.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryBackend }   from '@onderling/pseudo-pod';
import { createPendingQueue, QUEUE_PREFIX } from '../src/pendingQueue.js';

function fixedNow(t) { return () => t; }
function makeIdGen(start = 0) {
  let i = start;
  return () => `id-${++i}`;
}

function defaultEntry(overrides = {}) {
  return {
    uri:        'https://anne.pod/sharing/tasks/x',
    payload:    { type: 'task', text: 'hi' },
    etag:       '"v1"',
    type:       'task',
    recipients: ['agent://bob'],
    fromActor:  'agent://anne',
    circleId:     'circle-abc',
    ...overrides,
  };
}

describe('createPendingQueue — construction', () => {
  it('throws on missing backend', () => {
    expect(() => createPendingQueue({})).toThrow(/backend/);
  });

  it('exposes the storage prefix', () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    expect(q.QUEUE_PREFIX).toBe('__pending-pod-uploads__/');
    expect(QUEUE_PREFIX).toBe('__pending-pod-uploads__/');
  });
});

describe('enqueue', () => {
  it('stores an entry with auto-generated id + queuedAt', async () => {
    const backend = createMemoryBackend();
    const q = createPendingQueue({
      backend,
      now:    fixedNow('2026-05-11T10:00:00.000Z'),
      makeId: makeIdGen(),
    });
    const rec = await q.enqueue(defaultEntry());
    expect(rec.id).toBe('id-1');
    expect(rec.queuedAt).toBe('2026-05-11T10:00:00.000Z');
    expect(rec.uri).toBe(defaultEntry().uri);

    const keys = await backend.list(QUEUE_PREFIX);
    expect(keys).toEqual([QUEUE_PREFIX + 'id-1']);
  });

  it('respects a caller-provided id', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    const rec = await q.enqueue({ ...defaultEntry(), id: 'custom-id' });
    expect(rec.id).toBe('custom-id');
  });

  it('respects a caller-provided queuedAt', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    const rec = await q.enqueue({ ...defaultEntry(), queuedAt: '2020-01-01T00:00:00.000Z' });
    expect(rec.queuedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  it('rejects missing uri', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    await expect(q.enqueue({ type: 't', payload: 1 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects missing type', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    await expect(q.enqueue({ uri: 'x', payload: 1 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('list', () => {
  it('returns entries sorted by queuedAt (oldest first)', async () => {
    const backend = createMemoryBackend();
    const q = createPendingQueue({ backend });
    await q.enqueue({ ...defaultEntry(), id: 'a', queuedAt: '2026-05-11T10:00:02.000Z' });
    await q.enqueue({ ...defaultEntry(), id: 'b', queuedAt: '2026-05-11T10:00:01.000Z' });
    await q.enqueue({ ...defaultEntry(), id: 'c', queuedAt: '2026-05-11T10:00:03.000Z' });
    const out = await q.list();
    expect(out.map(e => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns empty array when nothing queued', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    expect(await q.list()).toEqual([]);
  });
});

describe('remove + clear + size', () => {
  it('remove drops a single entry by id', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend(), makeId: makeIdGen() });
    await q.enqueue(defaultEntry());
    await q.enqueue(defaultEntry());
    expect(await q.size()).toBe(2);
    await q.remove('id-1');
    expect(await q.size()).toBe(1);
  });

  it('clear empties the queue', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    await q.enqueue(defaultEntry());
    await q.enqueue(defaultEntry());
    await q.clear();
    expect(await q.size()).toBe(0);
  });
});

describe('drain', () => {
  it('uploads each entry then deletes it; re-emits envelope on success', async () => {
    const backend = createMemoryBackend();
    const q = createPendingQueue({ backend, makeId: makeIdGen() });
    await q.enqueue({ ...defaultEntry(), queuedAt: '2026-05-11T10:00:01.000Z' });
    await q.enqueue({ ...defaultEntry(), queuedAt: '2026-05-11T10:00:02.000Z' });

    const uploaded = [];
    const emitted  = [];
    const result = await q.drain({
      uploadFn: async (entry) => { uploaded.push(entry.id); },
      emitFn:   async (entry) => { emitted.push(entry.id);  },
    });
    expect(result.drained).toBe(2);
    expect(result.remaining).toBe(0);
    expect(uploaded).toEqual(['id-1', 'id-2']);
    expect(emitted).toEqual(['id-1', 'id-2']);
    expect(await q.size()).toBe(0);
  });

  it('stops on first upload failure and reports remaining', async () => {
    const backend = createMemoryBackend();
    const q = createPendingQueue({ backend, makeId: makeIdGen() });
    await q.enqueue({ ...defaultEntry(), queuedAt: '2026-05-11T10:00:01.000Z' });
    await q.enqueue({ ...defaultEntry(), queuedAt: '2026-05-11T10:00:02.000Z' });
    await q.enqueue({ ...defaultEntry(), queuedAt: '2026-05-11T10:00:03.000Z' });

    let attempts = 0;
    const result = await q.drain({
      uploadFn: async (entry) => {
        attempts++;
        if (entry.id === 'id-2') throw new Error('pod down');
      },
    });
    expect(result.drained).toBe(1);
    expect(result.remaining).toBe(2);
    expect(result.error?.message).toBe('pod down');
    expect(attempts).toBe(2);
    // Order preserved — next drain retries id-2 first.
    expect((await q.list()).map(e => e.id)).toEqual(['id-2', 'id-3']);
  });

  it('emit errors do not block the drain', async () => {
    const backend = createMemoryBackend();
    const q = createPendingQueue({ backend, makeId: makeIdGen() });
    await q.enqueue(defaultEntry());
    const result = await q.drain({
      uploadFn: async () => {},
      emitFn:   async () => { throw new Error('relay flake'); },
    });
    expect(result.drained).toBe(1);
  });

  it('emitFn is optional', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend(), makeId: makeIdGen() });
    await q.enqueue(defaultEntry());
    const result = await q.drain({ uploadFn: async () => {} });
    expect(result.drained).toBe(1);
  });

  it('requires uploadFn', async () => {
    const q = createPendingQueue({ backend: createMemoryBackend() });
    await expect(q.drain({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('persistence across queue restart', () => {
  it('a fresh queue on the same backend sees previously-enqueued entries', async () => {
    const backend = createMemoryBackend();
    const q1 = createPendingQueue({ backend, makeId: makeIdGen() });
    await q1.enqueue(defaultEntry());
    await q1.enqueue(defaultEntry());

    // Simulate process restart — new queue, same backend.
    const q2 = createPendingQueue({ backend });
    expect(await q2.size()).toBe(2);
    const entries = await q2.list();
    expect(entries.map(e => e.id)).toEqual(['id-1', 'id-2']);
  });
});
