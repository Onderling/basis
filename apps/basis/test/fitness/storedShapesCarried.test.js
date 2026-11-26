/**
 * Every storage register row says what it stores, and a row's `v` is the one its carrier writes.
 *
 * A `v` nobody writes is a number a later build trusts and an older build never sees. So: a store the snapshot gate
 * writes declares the gate's stamp (MAP_SNAPSHOT_V) until that store passes its own `v` to its gate; the device log's
 * row declares the `v` its manifest is written with; a key holds no stamp at all (`v: 'none'`) and names its value kind.
 * The guard over changes is `lint-shapes` (scripts/stored-shapes.json); this pins the declaration to the code.
 */
import { describe, it, expect } from 'vitest';
import { MAP_SNAPSHOT_V, mapSnapshotGate, readMapSnapshot } from '@onderling/local-store';
import { STORAGE } from '../../src/v2/storageRegister.js';
import { backendSnapshotIo } from '../../src/v2/eventLogPersistence.js';

const rows = Object.entries(STORAGE);
const VALUE_KINDS = ['flag', 'string', 'json', 'rows'];

describe('the storage register declares what each name stores', () => {
  it('every row has a shape: opaque, a carried v, or v none with a value kind', () => {
    for (const [id, r] of rows) {
      const s = r.shape;
      if (s === 'opaque') continue;
      expect(s, id).toBeTypeOf('object');
      if (s.v === 'none') expect(VALUE_KINDS, id).toContain(s.value);
      else {
        expect(s.v, id).toBeTypeOf('number');
        expect(['snapshot', 'device-log manifest'], id).toContain(s.carrier);
      }
    }
  });

  it('a vault row is opaque, and a key or key family never claims a carrier', () => {
    for (const [id, r] of rows) {
      if (r.kind === 'vault') expect(r.shape, id).toBe('opaque');
      if (r.kind === 'key') expect(r.shape === 'opaque' || r.shape.v === 'none', id).toBe(true);
    }
  });

  it('a snapshot store declares the stamp the gate writes (no store passes its own v yet)', () => {
    const snap = rows.filter(([, r]) => r.shape?.carrier === 'snapshot');
    expect(snap.length).toBeGreaterThan(0);
    for (const [id, r] of snap) expect(r.shape.v, id).toBe(MAP_SNAPSHOT_V);
    expect(JSON.parse(mapSnapshotGate('x', { warn: () => {} }).encode(new Map())).v).toBe(MAP_SNAPSHOT_V);
  });

  it('the gate writes and accepts the v it is given, and refuses another', () => {
    const gate = mapSnapshotGate('x', { v: 2, warn: () => {} });
    const text = gate.encode(new Map([['a', 1]]));
    expect(JSON.parse(text).v).toBe(2);
    expect(readMapSnapshot(text, 2).notReadable).toBe(null);
    expect(readMapSnapshot(text).notReadable).toBe('version');
  });

  it("the device log's row declares the v its manifest is written with", async () => {
    const kept = new Map();
    const backend = { get: async (k) => (kept.has(k) ? { bytes: kept.get(k) } : null), put: async (k, v) => { kept.set(k, v); }, delete: async (k) => { kept.delete(k); } };
    await backendSnapshotIo(backend, 'log').save([{ id: 'e1' }]);
    expect(STORAGE.deviceLog.shape.carrier).toBe('device-log manifest');
    expect(JSON.parse(kept.get('log')).v).toBe(STORAGE.deviceLog.shape.v);
  });
});
