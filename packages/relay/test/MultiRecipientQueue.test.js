/**
 * MultiRecipientQueue tests — covers MemoryQueueStore + SqliteQueueStore.
 *
 * Queueing for a recipient who is not connected, so a push wake-up has something to deliver.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync }                          from 'node:fs';
import { tmpdir }                                       from 'node:os';
import { join }                                         from 'node:path';

import { MultiRecipientQueue } from '../src/MultiRecipientQueue.js';
import { MemoryQueueStore }    from '../src/queueStores/MemoryQueueStore.js';
import { SqliteQueueStore }    from '../src/queueStores/SqliteQueueStore.js';

// Tight poll interval keeps these tests fast.
const QUEUE_OPTS = { pollIntervalMs: 5 };

// ── MultiRecipientQueue against MemoryQueueStore ─────────────────────────────

describe('MultiRecipientQueue (MemoryQueueStore)', () => {
  let queue;

  beforeEach(() => {
    queue = new MultiRecipientQueue({ store: new MemoryQueueStore(), ...QUEUE_OPTS });
  });

  afterEach(async () => {
    await queue.close();
  });

  it('returns immediately when targets is empty', async () => {
    const result = await queue.fanOut({
      callerPubKey: 'alice',
      targets:      [],
      payload:      { hi: true },
      dispatch:     () => {},
    });
    expect(result).toEqual({ id: null, responses: [], partial: false });
  });

  it('resolves partial:false when all targets respond before deadline', async () => {
    const dispatched = [];
    const fanOut = queue.fanOut({
      callerPubKey: 'alice',
      targets:      ['bob', 'carol'],
      payload:      { task: 'ping' },
      timeoutMs:    1_000,
      dispatch:     (t, p, ctx) => { dispatched.push({ t, p, id: ctx.id }); },
    });

    // Wait a microtask so the queue has written the request and dispatched.
    await new Promise(r => setTimeout(r, 10));
    expect(dispatched).toHaveLength(2);
    expect(dispatched[0].id).toBeTruthy();
    const reqId = dispatched[0].id;
    expect(dispatched.map(d => d.t).sort()).toEqual(['bob', 'carol']);

    await queue.addResponse(reqId, 'bob',   { ok: 'b' });
    await queue.addResponse(reqId, 'carol', { ok: 'c' });

    const result = await fanOut;
    expect(result.partial).toBe(false);
    expect(result.id).toBe(reqId);
    expect(result.responses).toHaveLength(2);
    const fromKeys = result.responses.map(r => r.fromPubKey).sort();
    expect(fromKeys).toEqual(['bob', 'carol']);
  });

  it('resolves partial:true on timeout with whatever responses arrived', async () => {
    let captured;
    const fanOut = queue.fanOut({
      callerPubKey: 'alice',
      targets:      ['bob', 'carol', 'dave'],
      payload:      { task: 'ping' },
      timeoutMs:    50,                                   // short deadline
      dispatch:     (_t, _p, ctx) => { captured = ctx.id; },
    });

    // Only bob replies before the deadline.
    await new Promise(r => setTimeout(r, 5));
    await queue.addResponse(captured, 'bob', { ok: true });

    const result = await fanOut;
    expect(result.partial).toBe(true);
    expect(result.id).toBe(captured);
    expect(result.responses).toHaveLength(1);
    expect(result.responses[0].fromPubKey).toBe('bob');
  });

  it('does not let one fan-out interfere with another running concurrently', async () => {
    const ids = [];
    const dispatch = (_t, _p, ctx) => { ids.push(ctx.id); };

    const a = queue.fanOut({
      callerPubKey: 'alice',
      targets:      ['x', 'y'],
      payload:      { n: 1 },
      timeoutMs:    1_000,
      dispatch,
    });
    const b = queue.fanOut({
      callerPubKey: 'alice',
      targets:      ['p', 'q'],
      payload:      { n: 2 },
      timeoutMs:    1_000,
      dispatch,
    });

    await new Promise(r => setTimeout(r, 10));
    // dispatch fired 4 times total, with two distinct ids
    const distinct = [...new Set(ids)];
    expect(distinct).toHaveLength(2);
    const [idA, idB] = distinct;

    // Reply on each in interleaved order.
    await queue.addResponse(idA, 'x', { fromA: 'x' });
    await queue.addResponse(idB, 'p', { fromB: 'p' });
    await queue.addResponse(idA, 'y', { fromA: 'y' });
    await queue.addResponse(idB, 'q', { fromB: 'q' });

    const [resA, resB] = await Promise.all([a, b]);
    expect(resA.partial).toBe(false);
    expect(resB.partial).toBe(false);
    expect(resA.responses.map(r => r.fromPubKey).sort()).toEqual(['x', 'y']);
    expect(resB.responses.map(r => r.fromPubKey).sort()).toEqual(['p', 'q']);
  });

  it('addResponse on an unknown id returns null without crashing', async () => {
    const r = await queue.addResponse('does-not-exist', 'bob', { ok: 1 });
    expect(r).toBe(null);
  });

  it('resumeOpen reports the count of still-open requests in the store', async () => {
    const store = new MemoryQueueStore();
    // Inject pre-existing open requests as if from a previous run.
    await store.putRequest({
      id: 'r1', callerPubKey: 'alice', targets: ['bob'],
      expectedResponses: 1, deadline: Date.now() + 60_000,
      payload: { hi: 1 }, createdAt: Date.now(),
    });
    await store.putRequest({
      id: 'r2', callerPubKey: 'alice', targets: ['carol'],
      expectedResponses: 1, deadline: Date.now() + 60_000,
      payload: { hi: 2 }, createdAt: Date.now(),
    });
    await store.closeRequest('r2');                      // r2 is closed → not open

    const q = new MultiRecipientQueue({ store, ...QUEUE_OPTS });
    expect(await q.resumeOpen()).toBe(1);
    await q.close();
  });
});

// ── SqliteQueueStore — round trip + persistence ──────────────────────────────

describe('SqliteQueueStore', () => {
  it('round-trips putRequest / addResponse / getRequest in :memory:', async () => {
    const store = new SqliteQueueStore({ path: ':memory:' });
    const req = await store.putRequest({
      id:                'r-1',
      callerPubKey:      'alice',
      targets:           ['bob', 'carol'],
      expectedResponses: 2,
      deadline:          Date.now() + 60_000,
      payload:           { task: 'do-the-thing' },
      createdAt:         Date.now(),
    });
    expect(req.id).toBe('r-1');
    expect(req.targets).toEqual(['bob', 'carol']);
    expect(req.responses).toEqual([]);
    expect(req.closed).toBe(false);

    const updated = await store.addResponse('r-1', 'bob', { ok: true });
    expect(updated.responses).toHaveLength(1);
    expect(updated.responses[0]).toMatchObject({ fromPubKey: 'bob', response: { ok: true } });

    const fresh = await store.getRequest('r-1');
    expect(fresh.responses).toHaveLength(1);
    expect(fresh.payload).toEqual({ task: 'do-the-thing' });

    await store.closeRequest('r-1');
    const after = await store.getRequest('r-1');
    expect(after.closed).toBe(true);

    await store.close();
  });

  it('persists across reopens of the same on-disk file', async () => {
    const dir  = mkdtempSync(join(tmpdir(), 'mrq-sqlite-'));
    const file = join(dir, 'queue.sqlite');
    try {
      const store1 = new SqliteQueueStore({ path: file });
      await store1.putRequest({
        id:                'persist-1',
        callerPubKey:      'alice',
        targets:           ['bob'],
        expectedResponses: 1,
        deadline:          Date.now() + 60_000,
        payload:           { msg: 'hello' },
        createdAt:         Date.now(),
      });
      await store1.addResponse('persist-1', 'bob', { reply: 'world' });
      await store1.close();

      const store2 = new SqliteQueueStore({ path: file });
      const reopened = await store2.getRequest('persist-1');
      expect(reopened).toBeTruthy();
      expect(reopened.callerPubKey).toBe('alice');
      expect(reopened.payload).toEqual({ msg: 'hello' });
      expect(reopened.responses).toHaveLength(1);
      expect(reopened.responses[0].response).toEqual({ reply: 'world' });
      await store2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('addResponse returns null after the request is closed', async () => {
    const store = new SqliteQueueStore({ path: ':memory:' });
    await store.putRequest({
      id: 'r-c', callerPubKey: 'alice', targets: ['bob'],
      expectedResponses: 1, deadline: Date.now() + 60_000,
      payload: {}, createdAt: Date.now(),
    });
    await store.closeRequest('r-c');
    const r = await store.addResponse('r-c', 'bob', { x: 1 });
    expect(r).toBe(null);
    await store.close();
  });

  it('listOpen filters out closed and expired requests', async () => {
    const store = new SqliteQueueStore({ path: ':memory:' });
    const now = Date.now();
    await store.putRequest({
      id: 'open',  callerPubKey: 'a', targets: ['b'],
      expectedResponses: 1, deadline: now + 60_000, payload: {}, createdAt: now,
    });
    await store.putRequest({
      id: 'closed', callerPubKey: 'a', targets: ['b'],
      expectedResponses: 1, deadline: now + 60_000, payload: {}, createdAt: now,
    });
    await store.closeRequest('closed');
    await store.putRequest({
      id: 'expired', callerPubKey: 'a', targets: ['b'],
      expectedResponses: 1, deadline: now - 10, payload: {}, createdAt: now - 1_000,
    });

    const open = await store.listOpen();
    expect(open.map(r => r.id)).toEqual(['open']);
    await store.close();
  });
});

// ── MultiRecipientQueue + SqliteQueueStore end-to-end ────────────────────────

describe('MultiRecipientQueue + SqliteQueueStore', () => {
  it('fans out and aggregates responses through a SQLite-backed store', async () => {
    const store = new SqliteQueueStore({ path: ':memory:' });
    const q     = new MultiRecipientQueue({ store, ...QUEUE_OPTS });

    let captured;
    const fanOut = q.fanOut({
      callerPubKey: 'alice',
      targets:      ['bob', 'carol'],
      payload:      { ping: true },
      timeoutMs:    1_000,
      dispatch:     (_t, _p, ctx) => { captured = ctx.id; },
    });

    await new Promise(r => setTimeout(r, 10));
    await q.addResponse(captured, 'bob',   { ok: 'b' });
    await q.addResponse(captured, 'carol', { ok: 'c' });

    const res = await fanOut;
    expect(res.partial).toBe(false);
    expect(res.responses).toHaveLength(2);
    await q.close();
  });
});
