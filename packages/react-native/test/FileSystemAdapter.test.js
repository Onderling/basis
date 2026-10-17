/**
 * FileSystemAdapter tests — mirrors apps/pinboard's FilePersist tests
 * but uses a stub `FileSystem` namespace.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileSystemAdapter } from '../src/storage/FileSystemAdapter.js';

/**
 * Build a stub `expo-file-system` namespace backed by an in-memory
 * Map. The map's keys are file URIs.
 */
function buildFakeFS() {
  const files = new Map();
  return {
    files,
    EncodingType: { UTF8: 'utf8', Base64: 'base64' },
    getInfoAsync: vi.fn(async (uri) => ({ exists: files.has(uri), uri })),
    readAsStringAsync: vi.fn(async (uri) => {
      if (!files.has(uri)) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      return files.get(uri);
    }),
    writeAsStringAsync: vi.fn(async (uri, data) => { files.set(uri, data); }),
    makeDirectoryAsync: vi.fn(async () => {}),
    deleteAsync:        vi.fn(async (uri) => { files.delete(uri); }),
    moveAsync:          vi.fn(async ({ from, to }) => {
      if (!files.has(from)) throw new Error('source missing');
      files.set(to, files.get(from));
      files.delete(from);
    }),
  };
}

describe('FileSystemAdapter — constructor', () => {
  it('rejects missing FileSystem', () => {
    expect(() => new FileSystemAdapter({ path: '/x' })).toThrow(/FileSystem/);
  });
  it('rejects missing path', () => {
    expect(() => new FileSystemAdapter({ FileSystem: buildFakeFS() })).toThrow(/path/);
  });
});

describe('FileSystemAdapter — load / save round-trip', () => {
  it('returns empty Map when no file exists', async () => {
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json' });
    const map = await a.load();
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });

  it('saves a Map and loads it back', async () => {
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json' });
    const original = new Map([['a', '1'], ['b', '2']]);
    await a.save(original);
    const loaded = await a.load();
    expect(loaded.size).toBe(2);
    expect(loaded.get('a')).toBe('1');
    expect(loaded.get('b')).toBe('2');
  });

  it('save uses tmp + move atomically', async () => {
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json' });
    await a.save(new Map([['a', '1']]));
    expect(fs.writeAsStringAsync).toHaveBeenCalledOnce();
    expect(fs.writeAsStringAsync.mock.calls[0][0]).toBe('file:///doc/x.json.tmp');
    expect(fs.moveAsync).toHaveBeenCalledOnce();
    expect(fs.moveAsync.mock.calls[0][0]).toEqual({
      from: 'file:///doc/x.json.tmp',
      to:   'file:///doc/x.json',
    });
  });

  it('save no-ops when serialised content is unchanged', async () => {
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json' });
    await a.save(new Map([['a', '1']]));
    fs.writeAsStringAsync.mockClear();
    await a.save(new Map([['a', '1']]));
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('load returns empty Map on corrupt JSON', async () => {
    const fs = buildFakeFS();
    fs.files.set('file:///doc/x.json', 'not-json{');
    const a = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json' });
    const map = await a.load();
    expect(map.size).toBe(0);
  });
});

describe('FileSystemAdapter — scheduleSave / flush / cancel', () => {
  beforeEach(() => vi.useRealTimers());

  it('scheduleSave debounces multiple writes into one save', async () => {
    vi.useFakeTimers();
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json', saveDelayMs: 100 });
    a.scheduleSave(new Map([['a', '1']]));
    a.scheduleSave(new Map([['a', '2']]));
    a.scheduleSave(new Map([['a', '3']]));
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(fs.writeAsStringAsync).toHaveBeenCalledOnce();
    expect(fs.files.get('file:///doc/x.json')).toBe(JSON.stringify({ a: '3' }));
  });

  it('flush forces a pending save', async () => {
    vi.useFakeTimers();
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json', saveDelayMs: 1000 });
    a.scheduleSave(new Map([['a', '1']]));
    await a.flush(new Map([['a', '1']]));
    expect(fs.writeAsStringAsync).toHaveBeenCalledOnce();
  });

  it('cancel drops a pending save', async () => {
    vi.useFakeTimers();
    const fs = buildFakeFS();
    const a  = new FileSystemAdapter({ FileSystem: fs, path: 'file:///doc/x.json', saveDelayMs: 100 });
    a.scheduleSave(new Map([['a', '1']]));
    a.cancel();
    await vi.advanceTimersByTimeAsync(150);
    expect(fs.writeAsStringAsync).not.toHaveBeenCalled();
  });
});
