import { describe, it, expect, vi } from 'vitest';
import {
  createSealedPodClient, recipientStrategy, groupKeyStrategy,
  generateKeypair, generateGroupKey, isSealed,
} from '../src/sealing/index.js';

// A Map-backed fake PodClient: stores raw bytes (what the host would hold). read echoes opts so we can
// assert the wrapper reads raw (decode:'text'); structure methods are spied for pass-through checks.
function fakeInner() {
  const store = new Map();
  return {
    store,
    async write(uri, content) { store.set(uri, content); return { uri, ok: true }; },
    async read(uri, opts) {
      if (!store.has(uri)) { const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e; }
      return { uri, content: store.get(uri), contentType: 'text/plain', etag: 'W/1', _opts: opts };
    },
    async append(uri, line) { store.set(uri, (store.get(uri) ? store.get(uri) + '\n' : '') + line); return { ok: true }; },
    list: vi.fn(async () => ({ container: '/', entries: [] })),
    createContainer: vi.fn(async () => ({ ok: true })),
    on: vi.fn(), off: vi.fn(),
  };
}

describe('SealedPodClient — recipient strategy', () => {
  it('seals on write (host sees ciphertext) and opens on read', async () => {
    const k = generateKeypair();
    const inner = fakeInner();
    const sealed = createSealedPodClient(inner, recipientStrategy({ recipients: k.publicKey, privateKey: k.privateKey }));

    await sealed.write('/note', 'top secret');
    const raw = inner.store.get('/note');
    expect(isSealed(raw)).toBe(true);
    expect(raw).not.toContain('top secret');           // the host holds ciphertext only

    const res = await sealed.read('/note');
    expect(res.content).toBe('top secret');            // opened transparently
    expect(res.etag).toBe('W/1');                      // metadata preserved
    expect(res._opts.decode).toBe('text');             // read raw, not auto-decoded
  });

  it('a writer with only public keys can seal; opening needs the private key', async () => {
    const k = generateKeypair();
    const inner = fakeInner();
    const writeOnly = createSealedPodClient(inner, recipientStrategy({ recipients: k.publicKey }));  // no privateKey
    await writeOnly.write('/x', 'data');               // host-blind write works
    await expect(writeOnly.read('/x')).rejects.toThrow(/private key/);
  });
});

describe('SealedPodClient — group-key strategy', () => {
  it('round-trips under a shared group key', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();
    const a = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    await a.write('/list', 'milk, bread');
    expect(isSealed(inner.store.get('/list'))).toBe(true);
    // a second member with the same group key reads it
    const b = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    expect((await b.read('/list')).content).toBe('milk, bread');
  });

  it('seals each appended line', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();
    const c = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    await c.append('/log', 'line one');
    await c.append('/log', 'line two');
    const lines = inner.store.get('/log').split('\n');
    expect(lines.every(isSealed)).toBe(true);
    expect(lines).toHaveLength(2);
  });
});

describe('SealedPodClient — pass-through + guards', () => {
  it('forwards structure + event methods unchanged (bodies untouched)', async () => {
    const inner = fakeInner();
    const c = createSealedPodClient(inner, groupKeyStrategy({ groupKey: generateGroupKey() }));
    await c.list('/c'); c.on('x', () => {});
    expect(inner.list).toHaveBeenCalledWith('/c');
    expect(inner.on).toHaveBeenCalled();
    expect(c.inner).toBe(inner);
  });

  it('open passes legacy/plaintext bodies through (mixed pod)', async () => {
    const gk = generateGroupKey();
    const inner = fakeInner();
    inner.store.set('/legacy', 'unsealed value');      // pre-existing plaintext
    const c = createSealedPodClient(inner, groupKeyStrategy({ groupKey: gk }));
    expect((await c.read('/legacy')).content).toBe('unsealed value');
  });

  it('requires a valid inner client + strategy', () => {
    expect(() => createSealedPodClient(null, groupKeyStrategy({ groupKey: generateGroupKey() }))).toThrow();
    expect(() => createSealedPodClient(fakeInner(), {})).toThrow();
  });
});
