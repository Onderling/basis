/**
 * The device log is persisted in SEGMENTS, not as one value (L120).
 *
 * One value for the whole log walks toward Android's ~2 MB AsyncStorage cursor window, past which a read returns
 * EMPTY and the next save writes that emptiness back — silent loss of the whole record. Segments keep every row
 * small, and an append-mostly log rewrites only its newest segment. The io contract the log sees is unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { backendSnapshotIo, SEGMENT_MAX_CHARS } from '../../src/v2/eventLogPersistence.js';

function memoryBackend() {
  const rows = new Map();
  return {
    rows,
    async get(key) { return rows.has(key) ? { bytes: rows.get(key) } : null; },
    async put(key, bytes) { rows.set(key, bytes); },
    async delete(key) { rows.delete(key); },
    async list(prefix) { return [...rows.keys()].filter((k) => k.startsWith(prefix)).sort(); },
  };
}
const dec = new TextDecoder();
const text = (b) => (typeof b === 'string' ? b : dec.decode(b));
// newest-first, like the log's own snapshot
const events = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `e${from + n - 1 - i}`, kind: 'chat-message', ts: from + n - 1 - i, body: 'x'.repeat(400) }));

describe('the device log in segments', () => {
  it('a large log is written as several segments, each under the cap, and loads back in the same order', async () => {
    const be = memoryBackend(); const io = backendSnapshotIo(be, 'device-log/events.json');
    const evs = events(3000);
    await io.save(evs);
    const segs = await be.list('device-log/events.json/seg/');
    expect(segs.length).toBeGreaterThan(3);
    for (const k of segs) expect(text(be.rows.get(k)).length).toBeLessThanOrEqual(SEGMENT_MAX_CHARS);
    expect(await io.load()).toEqual(evs);
  });

  it('an append rewrites only the NEWEST segment and the manifest — the old segments are not touched', async () => {
    const be = memoryBackend(); const io = backendSnapshotIo(be, 'device-log/events.json');
    await io.save(events(3000));
    const put = vi.spyOn(be, 'put');
    const more = [{ id: 'new', kind: 'chat-message', ts: 99999, body: 'hi' }, ...events(3000)];
    await io.save(more);
    const written = put.mock.calls.map((c) => c[0]);
    const segWrites = written.filter((k) => k.includes('/seg/'));
    expect(segWrites.length).toBeLessThanOrEqual(2);          // the changed tail segment (+ at most one new one)
    expect(written).toContain('device-log/events.json');      // the manifest
    expect(await io.load()).toEqual(more);
  });

  it('a legacy single-value snapshot still loads, and the next save migrates it to segments', async () => {
    const be = memoryBackend(); const io = backendSnapshotIo(be, 'device-log/events.json');
    const evs = events(50);
    await be.put('device-log/events.json', new TextEncoder().encode(JSON.stringify(evs)));
    expect(await io.load()).toEqual(evs);
    await io.save(evs);
    expect(JSON.parse(text(be.rows.get('device-log/events.json'))).v).toBe(1);   // a manifest now, not the array
    expect((await be.list('device-log/events.json/seg/')).length).toBeGreaterThan(0);
    expect(await io.load()).toEqual(evs);
  });

  it('a corrupt segment loses only itself, never the whole log', async () => {
    const be = memoryBackend(); const io = backendSnapshotIo(be, 'device-log/events.json');
    const evs = events(3000);
    await io.save(evs);
    const segs = await be.list('device-log/events.json/seg/');
    be.rows.set(segs[1], new TextEncoder().encode('{not json'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loaded = await io.load();
    warn.mockRestore();
    expect(loaded.length).toBeGreaterThan(evs.length / 2);
    expect(loaded.length).toBeLessThan(evs.length);
    expect(loaded.map((e) => e.id)).toEqual(evs.map((e) => e.id).filter((id) => loaded.some((e) => e.id === id)));   // order kept
  });

  it('a save that shrinks the log (retention pruned old entries) drops the segments that are no longer needed', async () => {
    const be = memoryBackend(); const io = backendSnapshotIo(be, 'device-log/events.json');
    await io.save(events(3000));
    const before = (await be.list('device-log/events.json/seg/')).length;
    const kept = events(3000).slice(0, 300);
    await io.save(kept);
    const after = (await be.list('device-log/events.json/seg/')).length;
    expect(after).toBeLessThan(before);
    expect(await io.load()).toEqual(kept);
  });

  it('an empty log is an empty manifest, and loads as empty', async () => {
    const be = memoryBackend(); const io = backendSnapshotIo(be, 'device-log/events.json');
    await io.save([]);
    expect(await io.load()).toEqual([]);
  });
});
