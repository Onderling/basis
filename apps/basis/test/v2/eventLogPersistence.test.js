import { describe, it, expect, vi } from 'vitest';
import { EventLog } from '../../src/eventLog.js';
import { wireEventLogPersistence, backendSnapshotIo, asyncStorageSnapshotIo } from '../../src/v2/eventLogPersistence.js';

// The durability slice: the device log survives a reload. Round-trip through both io shapes, hydrate
// dedup (a later rehydrate-from-store must not double entries), the debounce coalescing bursts, and the
// degrade paths (corrupt snapshot → empty log; failing medium → in-memory, never a broken append).

const entry = (id, type = 'governance', extra = {}) => ({ id, ts: Date.now(), app: 'system', type, circleId: 'c1', payload: { p: id }, ...extra });

function memAsyncStorage() {
  const m = new Map();
  return {
    async getItem(k) { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, v); },
    _m: m,
  };
}
function memBackend() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? { bytes: m.get(k) } : null; },
    async put(k, bytes) { m.set(k, bytes); },
  };
}

const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

describe('device-log durability', () => {
  it('round-trips: appended entries survive into a NEW log via the asyncStorage io', async () => {
    const storage = memAsyncStorage();
    const log1 = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log1, io: asyncStorageSnapshotIo(storage), debounceMs: 10 });
    log1.appendSilentEntry({ circleId: 'c1', kind: 'governance', payload: { p: 1 }, id: 'g1' });
    log1.appendSilentEntry({ circleId: 'c1', kind: 'membership', payload: { p: 2 }, id: 'm1' });
    await settle(80);

    const log2 = new EventLog({ initial: [] });
    const { hydrated } = await wireEventLogPersistence({ eventLog: log2, io: asyncStorageSnapshotIo(storage), debounceMs: 10 });
    expect(hydrated).toBe(2);
    expect(log2.query({}).map((e) => e.id).sort()).toEqual(['g1', 'm1']);
  });

  it('round-trips through the StorageBackend io (the web shape)', async () => {
    const backend = memBackend();
    const log1 = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log1, io: backendSnapshotIo(backend), debounceMs: 10 });
    log1.append(entry('e1'));
    await settle(80);
    const log2 = new EventLog({ initial: [] });
    const { hydrated } = await wireEventLogPersistence({ eventLog: log2, io: backendSnapshotIo(backend), debounceMs: 10 });
    expect(hydrated).toBe(1);
    expect(log2.query({}).some((e) => e.id === 'e1')).toBe(true);
  });

  it('hydrate dedups by id — a rehydrate-from-store AFTER hydration never doubles an entry', async () => {
    const storage = memAsyncStorage();
    const log1 = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log1, io: asyncStorageSnapshotIo(storage), debounceMs: 10 });
    log1.append(entry('dup-1', 'chat-message'));
    await settle(80);

    const log2 = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log2, io: asyncStorageSnapshotIo(storage), debounceMs: 10 });
    log2.append(entry('dup-1', 'chat-message'));   // the store-rehydrate path re-inserts the same msgId
    expect(log2.query({}).filter((e) => e.id === 'dup-1')).toHaveLength(1);
  });

  it('bursts coalesce: N appends → far fewer saves (the debounce)', async () => {
    const save = vi.fn(async () => {});
    const log = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log, io: { load: async () => null, save }, debounceMs: 20 });
    for (let i = 0; i < 25; i += 1) log.append(entry(`b${i}`));
    await settle(120);
    expect(save.mock.calls.length).toBeLessThan(5);
    expect(save.mock.calls.at(-1)[0].length).toBe(25);   // the trailing save carries the full snapshot
  });

  it('a CORRUPT snapshot degrades to an empty log, never a broken boot', async () => {
    const storage = memAsyncStorage();
    await storage.setItem('cc-device-log', '{not json');
    const log = new EventLog({ initial: [] });
    const { hydrated } = await wireEventLogPersistence({ eventLog: log, io: asyncStorageSnapshotIo(storage) });
    expect(hydrated).toBe(0);
    expect(() => log.append(entry('after'))).not.toThrow();
  });

  it('a FAILING medium degrades to in-memory — appends keep working, one warning', async () => {
    const log = new EventLog({ initial: [] });
    await wireEventLogPersistence({
      eventLog: log,
      io: { load: async () => null, save: async () => { throw new Error('quota'); } },
      debounceMs: 5,
    });
    log.append(entry('x1'));
    log.append(entry('x2'));
    await settle(50);
    expect(log.query({}).length).toBe(2);   // the log itself is unaffected
  });

  it('hydration respects retention on load: expired plumbing prunes, RECORD kinds survive regardless of age', async () => {
    const old = Date.now() - 40 * 24 * 3600 * 1000;   // 40 days — far past every window
    const storage = memAsyncStorage();
    await storage.setItem('cc-device-log', JSON.stringify([
      { id: 'old-ping', ts: old, app: 'system', type: 'delivery-state', circleId: 'c1', payload: {}, silent: true },
      { id: 'old-chat', ts: old, app: 'kring', type: 'chat-message', circleId: 'c1', payload: {} },
      { id: 'old-membership', ts: old, app: 'system', type: 'membership', circleId: 'c1', payload: {}, silent: true },
    ]));
    const log = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log, io: asyncStorageSnapshotIo(storage) });
    const ids = log.query({}).map((e) => e.id);
    expect(ids).not.toContain('old-ping');           // short-class plumbing still ages out on hydrate
    expect(ids).toContain('old-chat');               // chat is RECORD class — the conversation never drops
    expect(ids).toContain('old-membership');         // membership too — the roster stays rebuildable
  });
});
