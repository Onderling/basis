/**
 * A STORE'S SNAPSHOT IS STAMPED, AND A SNAPSHOT THIS BUILD CANNOT READ IS NEVER SAVED OVER.
 *
 * The persist adapters read anything they could not parse as an empty Map, and the next save wrote that empty Map
 * over the stored bytes. The shared reading: no `v` = today's format (read, stamped at the next save); an unknown
 * `v`, bytes that do not parse, or a non-object = not readable, and the gate refuses every save after it.
 */
import { describe, it, expect } from 'vitest';
import { readMapSnapshot, writeMapSnapshot, mapSnapshotGate, MAP_SNAPSHOT_V } from '../src/mapSnapshot.js';

describe('mapSnapshot', () => {
  it('nothing stored is an empty, readable store', () => {
    for (const raw of [null, undefined, '']) expect(readMapSnapshot(raw)).toEqual({ map: new Map(), notReadable: null });
  });

  it('a snapshot without v (today\'s format) reads as v1, and the next write stamps it', () => {
    const raw = JSON.stringify({ 'mem://household/items/a': '{"t":"brood"}' });
    const { map, notReadable } = readMapSnapshot(raw);
    expect(notReadable).toBeNull();
    expect([...map]).toEqual([['mem://household/items/a', '{"t":"brood"}']]);
    expect(JSON.parse(writeMapSnapshot(map))).toEqual({ v: MAP_SNAPSHOT_V, data: { 'mem://household/items/a': '{"t":"brood"}' } });
  });

  it('a stamped snapshot reads back', () => {
    const m = new Map([['k', 'v1']]);
    expect(readMapSnapshot(writeMapSnapshot(m))).toEqual({ map: m, notReadable: null });
  });

  it('an unknown v, unparseable bytes, or a non-object are not readable', () => {
    expect(readMapSnapshot(JSON.stringify({ v: 2, data: { k: 'x' } })).notReadable).toBe('version');
    expect(readMapSnapshot('{"k": "torn').notReadable).toBe('unparseable');
    expect(readMapSnapshot('[1,2]').notReadable).toBe('shape');
    expect(readMapSnapshot('"text"').notReadable).toBe('shape');
    expect(readMapSnapshot(JSON.stringify({ v: 1, data: [1] })).notReadable).toBe('shape');
  });

  it('the gate refuses every save over a snapshot it could not read, and says so once', () => {
    const said = [];
    const gate = mapSnapshotGate('household-items.json', (m) => said.push(m));
    expect(gate.read(JSON.stringify({ v: 9, data: {} }))).toEqual(new Map());
    expect(gate.notReadable).toBe('version');
    expect(gate.encode(new Map())).toBeNull();
    expect(gate.encode(new Map([['k', 'new']]))).toBeNull();
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('household-items.json');
  });

  it('a failed read refuses saves too', () => {
    const gate = mapSnapshotGate('db', () => {});
    gate.readFailed();
    expect(gate.encode(new Map())).toBeNull();
  });

  it('a readable snapshot saves normally', () => {
    const gate = mapSnapshotGate('x', () => {});
    gate.read(null);
    expect(gate.encode(new Map([['k', 'v']]))).toBe(writeMapSnapshot(new Map([['k', 'v']])));
  });
});
