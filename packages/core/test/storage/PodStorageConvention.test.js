/**
 * PodStorageConvention — `writeWithConvention` / `readWithConvention` tests.
 *
 * Uses an in-memory mock for both `podSource` and `externalStore` so we can
 * assert the inline / referenced branches without touching a real Solid
 * server.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  DEFAULT_CONVENTION_THRESHOLD,
  readWithConvention,
  writeWithConvention,
} from '../../src/storage/PodStorageConvention.js';

import {
  hashContent,
  isReferenceManifest,
  parseReferenceManifest,
  serializeReferenceManifest,
} from '../../src/storage/reference-manifest.js';

import { NoneStore } from '../../src/storage/external-stores/NoneStore.js';

/* ─────────────────────────────────────────────────────────────────────────── */

/** Mock `DataSource` that records writes + replays them on read. */
function makePodSource() {
  const store = new Map();
  return {
    store,
    write: vi.fn(async (uri, content, opts = {}) => {
      const bytes = bytesOf(content);
      const ct    = opts.contentType ?? 'application/octet-stream';
      store.set(uri, { content: bytes, contentType: ct });
      return {
        uri,
        contentType:  ct,
        lastModified: '2026-04-28T12:00:00Z',
        etag:         '"abc123"',
        size:         bytes.byteLength,
      };
    }),
    read: vi.fn(async (uri) => {
      const entry = store.get(uri);
      if (!entry) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      return {
        content:      entry.content,
        contentType:  entry.contentType,
        lastModified: '2026-04-28T12:00:00Z',
        etag:         '"abc123"',
        size:         entry.content.byteLength,
      };
    }),
  };
}

/** Mock external store. */
function makeExternalStore({ corruptOnGet = false } = {}) {
  const store = new Map();
  let nextId  = 0;
  return {
    store,
    put: vi.fn(async (blob, opts) => {
      const uri   = `mock-store://blob-${nextId++}`;
      const bytes = bytesOf(blob);
      store.set(uri, { content: bytes, contentType: opts?.contentType, hash: opts?.hash });
      return uri;
    }),
    get: vi.fn(async (uri) => {
      const entry = store.get(uri);
      if (!entry) throw Object.assign(new Error('not found'), { code: 'NOT_FOUND' });
      if (corruptOnGet) {
        // Flip a byte so the hash mismatches.
        const corrupted = new Uint8Array(entry.content);
        corrupted[0] = corrupted[0] ^ 0xff;
        return corrupted;
      }
      return entry.content;
    }),
    delete: vi.fn(async (uri) => { store.delete(uri); }),
    exists: vi.fn(async (uri) => store.has(uri)),
  };
}

function bytesOf(content) {
  if (typeof content === 'string') return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(content)) {
    return new Uint8Array(content.buffer, content.byteOffset, content.byteLength);
  }
  if (content instanceof ArrayBuffer) return new Uint8Array(content);
  return new TextEncoder().encode(JSON.stringify(content));
}

function makeBytes(size, fill = 0x41) {
  const buf = new Uint8Array(size);
  buf.fill(fill);
  return buf;
}

/* ─────────────────────────────────────────────────────────────────────────── */

describe('writeWithConvention — inline path (small content)', () => {
  let pod;
  let store;
  beforeEach(() => { pod = makePodSource(); store = makeExternalStore(); });

  it('writes 500 KB inline and does not call externalStore.put', async () => {
    const content = makeBytes(500_000);
    const result  = await writeWithConvention(pod, store, '/notes/small.bin', content);

    expect(pod.write).toHaveBeenCalledTimes(1);
    expect(store.put).not.toHaveBeenCalled();
    expect(result.convention).toBe('inline');

    // Pod got the raw bytes — not a manifest.
    const stored = pod.store.get('/notes/small.bin');
    expect(stored.content).toEqual(content);
    expect(isReferenceManifest(stored.content)).toBe(false);
  });

  it('writes a small string inline as text/plain', async () => {
    const result = await writeWithConvention(pod, store, '/notes/hi.txt', 'hello world');
    expect(result.convention).toBe('inline');
    expect(pod.write.mock.calls[0][2].contentType).toMatch(/^text\/plain/);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('writes a small object inline as application/json', async () => {
    const obj    = { hello: 'world', n: 42 };
    const result = await writeWithConvention(pod, store, '/notes/obj.json', obj);
    expect(result.convention).toBe('inline');
    expect(pod.write.mock.calls[0][2].contentType).toBe('application/json');
    // Stored bytes should round-trip JSON
    const stored = pod.store.get('/notes/obj.json');
    expect(JSON.parse(new TextDecoder().decode(stored.content))).toEqual(obj);
  });

  it('honours explicit opts.contentType', async () => {
    await writeWithConvention(pod, store, '/notes/hi.txt', 'hi', { contentType: 'text/markdown' });
    expect(pod.write.mock.calls[0][2].contentType).toBe('text/markdown');
  });
});

describe('writeWithConvention — reference path (big content)', () => {
  let pod;
  let store;
  beforeEach(() => { pod = makePodSource(); store = makeExternalStore(); });

  it('writes 5 MB to externalStore and a manifest to the pod', async () => {
    const content = makeBytes(5_000_000);
    const result  = await writeWithConvention(pod, store, '/photos/big.jpg', content, {
      contentType: 'image/jpeg',
    });

    expect(store.put).toHaveBeenCalledTimes(1);
    expect(pod.write).toHaveBeenCalledTimes(1);
    expect(result.convention).toBe('reference');

    // externalStore was given the right contentType + a sha256 hash
    const putOpts = store.put.mock.calls[0][1];
    expect(putOpts.contentType).toBe('image/jpeg');
    expect(putOpts.hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    // Pod got a manifest, not the raw bytes
    const stored = pod.store.get('/photos/big.jpg');
    expect(stored.contentType).toBe('application/json');
    const parsed = parseReferenceManifest(stored.content);
    expect(parsed).not.toBeNull();
    expect(parsed.contentType).toBe('image/jpeg');
    expect(parsed.size).toBe(5_000_000);
    expect(parsed.hash).toBe(hashContent(content));
    expect(parsed.uri).toMatch(/^mock-store:\/\//);
  });

  it('default threshold is 1 MB', () => {
    expect(DEFAULT_CONVENTION_THRESHOLD).toBe(1_000_000);
  });

  it('configurable threshold: 200 KB write goes external when threshold = 100 KB', async () => {
    const content = makeBytes(200_000);
    const result  = await writeWithConvention(pod, store, '/notes/medium.bin', content, {
      threshold: 100_000,
    });
    expect(result.convention).toBe('reference');
    expect(store.put).toHaveBeenCalledTimes(1);
  });

  it('configurable threshold: 200 KB write stays inline when threshold = 1 MB', async () => {
    const content = makeBytes(200_000);
    const result  = await writeWithConvention(pod, store, '/notes/medium.bin', content);
    expect(result.convention).toBe('inline');
    expect(store.put).not.toHaveBeenCalled();
  });

  it('rejects EXTERNAL_STORE_NOT_CONFIGURED when NoneStore is asked to put', async () => {
    const content = makeBytes(5_000_000);
    const none    = new NoneStore();
    await expect(
      writeWithConvention(pod, none, '/photos/big.jpg', content, { contentType: 'image/jpeg' })
    ).rejects.toMatchObject({ code: 'EXTERNAL_STORE_NOT_CONFIGURED' });

    // Pod should not have been written either.
    expect(pod.write).not.toHaveBeenCalled();
  });

  it('uses NoneStore as the default external store', async () => {
    const content = makeBytes(5_000_000);
    // Pass `undefined` as externalStore — should be the same as NoneStore.
    await expect(
      writeWithConvention(pod, undefined, '/photos/big.jpg', content)
    ).rejects.toMatchObject({ code: 'EXTERNAL_STORE_NOT_CONFIGURED' });
  });
});

describe('writeWithConvention — argument validation', () => {
  it('rejects when podSource lacks write', async () => {
    await expect(
      writeWithConvention({}, makeExternalStore(), '/x', 'hi')
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects empty uri', async () => {
    await expect(
      writeWithConvention(makePodSource(), makeExternalStore(), '', 'hi')
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('rejects null content', async () => {
    await expect(
      writeWithConvention(makePodSource(), makeExternalStore(), '/x', null)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('readWithConvention — inline path', () => {
  it('returns the inline content unchanged', async () => {
    const pod   = makePodSource();
    const store = makeExternalStore();
    await writeWithConvention(pod, store, '/notes/hi.txt', 'hello world');

    const result = await readWithConvention(pod, store, '/notes/hi.txt');
    expect(new TextDecoder().decode(result.content)).toBe('hello world');
    expect(result.contentType).toMatch(/^text\/plain/);
    expect(store.get).not.toHaveBeenCalled();
  });
});

describe('readWithConvention — reference path', () => {
  it('follows a reference manifest and returns the external bytes', async () => {
    const pod     = makePodSource();
    const store   = makeExternalStore();
    const content = makeBytes(5_000_000, 0x42);

    await writeWithConvention(pod, store, '/photos/big.jpg', content, { contentType: 'image/jpeg' });

    const result = await readWithConvention(pod, store, '/photos/big.jpg');

    expect(store.get).toHaveBeenCalledTimes(1);
    expect(result.content).toBeInstanceOf(Uint8Array);
    expect(result.content.byteLength).toBe(5_000_000);
    expect(result.content[0]).toBe(0x42);
    expect(result.contentType).toBe('image/jpeg');
    expect(result.size).toBe(5_000_000);
    // pod-resource metadata still surfaces
    expect(result.lastModified).toBe('2026-04-28T12:00:00Z');
    expect(result.etag).toBe('"abc123"');
  });

  it('throws HASH_MISMATCH when external bytes are corrupted', async () => {
    const pod     = makePodSource();
    const writeStore = makeExternalStore();
    const content = makeBytes(5_000_000, 0x42);
    await writeWithConvention(pod, writeStore, '/photos/big.jpg', content, { contentType: 'image/jpeg' });

    // Swap in a corruption-inducing read store that shares the same blobs.
    const readStore = makeExternalStore({ corruptOnGet: true });
    // Copy the blob across so the URIs resolve.
    for (const [k, v] of writeStore.store) readStore.store.set(k, v);

    await expect(
      readWithConvention(pod, readStore, '/photos/big.jpg')
    ).rejects.toMatchObject({ code: 'HASH_MISMATCH' });
  });

  it('throws INVALID_MANIFEST when the pod returns a malformed manifest', async () => {
    const pod   = makePodSource();
    const store = makeExternalStore();

    // Hand-craft a manifest with a bad hash and write it as if it were
    // legitimate content.  We bypass writeWithConvention to inject the
    // malformed payload.
    const bogus = JSON.stringify({
      $type:       'external-reference',
      uri:         'mock-store://nope',
      contentType: 'image/jpeg',
      size:        100,
      hash:        'sha256:bad',
    });
    pod.store.set('/photos/bad.jpg', {
      content:     new TextEncoder().encode(bogus),
      contentType: 'application/json',
    });

    await expect(
      readWithConvention(pod, store, '/photos/bad.jpg')
    ).rejects.toMatchObject({ code: 'INVALID_MANIFEST' });
  });

  it('argument-validates podSource and uri', async () => {
    const store = makeExternalStore();
    await expect(readWithConvention({}, store, '/x'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(readWithConvention(makePodSource(), store, ''))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});

describe('round-trip — full inline cycle', () => {
  it('writes 500 KB inline and reads it back identically', async () => {
    const pod     = makePodSource();
    const store   = makeExternalStore();
    const content = makeBytes(500_000, 0x37);

    await writeWithConvention(pod, store, '/file.bin', content);
    const round = await readWithConvention(pod, store, '/file.bin');

    expect(round.content).toEqual(content);
    expect(store.put).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
  });
});

describe('round-trip — full reference cycle', () => {
  it('writes 5 MB external, reads back identically via the manifest', async () => {
    const pod     = makePodSource();
    const store   = makeExternalStore();
    const content = makeBytes(5_000_000, 0x37);

    await writeWithConvention(pod, store, '/file.bin', content, { contentType: 'application/octet-stream' });
    const round = await readWithConvention(pod, store, '/file.bin');

    expect(round.content.byteLength).toBe(5_000_000);
    expect(round.content[0]).toBe(0x37);
    expect(round.content[round.content.byteLength - 1]).toBe(0x37);
    expect(round.contentType).toBe('application/octet-stream');
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(store.get).toHaveBeenCalledTimes(1);
  });
});

describe('NoneStore — direct calls all throw', () => {
  it('put / get / delete / exists all reject with EXTERNAL_STORE_NOT_CONFIGURED', async () => {
    const ns = new NoneStore();
    await expect(ns.put(new Uint8Array(0), {})).rejects.toMatchObject({ code: 'EXTERNAL_STORE_NOT_CONFIGURED' });
    await expect(ns.get('x')).rejects.toMatchObject({ code: 'EXTERNAL_STORE_NOT_CONFIGURED' });
    await expect(ns.delete('x')).rejects.toMatchObject({ code: 'EXTERNAL_STORE_NOT_CONFIGURED' });
    await expect(ns.exists('x')).rejects.toMatchObject({ code: 'EXTERNAL_STORE_NOT_CONFIGURED' });
  });
});

describe('serializeReferenceManifest — sanity', () => {
  it('always lists $type first', () => {
    const json = serializeReferenceManifest({
      $type:       'external-reference',
      uri:         's3://x/y',
      contentType: 'text/plain',
      size:        3,
      hash:        'sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9',
    });
    // Field order in stringified JSON: $type, uri, contentType, size, hash.
    expect(json.startsWith('{"$type":')).toBe(true);
  });
});
