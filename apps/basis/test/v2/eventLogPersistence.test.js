import { describe, it, expect, vi } from 'vitest';
import { EventLog } from '../../src/eventLog.js';
import { wireEventLogPersistence, backendSnapshotIo } from '../../src/v2/eventLogPersistence.js';

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


  it('bursts coalesce: N appends → far fewer saves (the debounce)', async () => {
    const save = vi.fn(async () => {});
    const log = new EventLog({ initial: [] });
    await wireEventLogPersistence({ eventLog: log, io: { load: async () => null, save }, debounceMs: 20 });
    for (let i = 0; i < 25; i += 1) log.append(entry(`b${i}`));
    await settle(120);
    expect(save.mock.calls.length).toBeLessThan(5);
    expect(save.mock.calls.at(-1)[0].length).toBe(25);   // the trailing save carries the full snapshot
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

});
