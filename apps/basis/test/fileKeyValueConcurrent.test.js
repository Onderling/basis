/**
 * The box's small key-value file (`circle-policy.json`, the stashed enrol offer): several writes at once. It crashed the
 * box on CI (the feedback walk, twice): joining two circles wrote two policies together, both through one fixed
 * `.tmp` name — the first rename moved it, the second found nothing (ENOENT, unhandled: the box died). And a quieter
 * loss beside it: two read-modify-writes at once each wrote back only their own key.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileKeyValueStorage, fileSnapshotIo } from '../src/v2/eventLogPersistence.js';

const dirs = [];
afterAll(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {}); });
const dir = async () => { const d = await mkdtemp(path.join(tmpdir(), 'kv-concurrent-')); dirs.push(d); return d; };

describe('the key-value file under concurrent writes', () => {
  it('twenty writes at once: none throws, every key is kept', async () => {
    const file = path.join(await dir(), 'circle-policy.json');
    const kv = fileKeyValueStorage(file);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => kv.setItem(`circle-${i}`, `policy-${i}`)));
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message)).toEqual([]);
    const onDisk = JSON.parse(await readFile(file, 'utf8'));
    for (let i = 0; i < 20; i += 1) expect(onDisk[`circle-${i}`], `circle-${i}`).toBe(`policy-${i}`);
  });
  it('a write and a remove at once land in the order asked', async () => {
    const kv = fileKeyValueStorage(path.join(await dir(), 'kv.json'));
    await kv.setItem('a', '1');
    await Promise.all([kv.setItem('b', '2'), kv.removeItem('a'), kv.setItem('c', '3')]);
    expect(await kv.getItem('a')).toBeNull();
    expect(await kv.getItem('b')).toBe('2');
    expect(await kv.getItem('c')).toBe('3');
  });
  it('the snapshot io too: saves at once never throw, the last one stands', async () => {
    const io = fileSnapshotIo(path.join(await dir(), 'device-log.json'));
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) => io.save({ n: i })));
    expect(results.filter((r) => r.status === 'rejected').map((r) => r.reason?.message)).toEqual([]);
    expect(await io.load()).toEqual({ n: 9 });
  });
});
