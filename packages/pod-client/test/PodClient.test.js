import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  PodClient,
  AuthError,
  CapabilityError,
  ConflictError,
  NetworkError,
  NotFoundError,
  PodClientError,
  PolicyError,
  ConventionError,
} from '../src/index.js';

// ── Inrupt mocks (used only by patch) ────────────────────────────────────────
//
// Order matters in vitest: vi.mock calls are hoisted, but we want stable
// references for assertions, so we use vi.hoisted.

const inrupt = vi.hoisted(() => {
  return {
    getSolidDataset:   vi.fn(),
    saveSolidDatasetAt: vi.fn(),
    getThing:          vi.fn(),
    setThing:          vi.fn((ds) => ds),
    createThing:       vi.fn(({ url } = {}) => ({ url, predicates: [] })),
    addUrl:            vi.fn((thing, p, o) => ({ ...thing, predicates: [...thing.predicates, ['add-url', p, o]] })),
    addStringNoLocale: vi.fn((thing, p, o) => ({ ...thing, predicates: [...thing.predicates, ['add-str', p, o]] })),
    removeUrl:         vi.fn((thing, p, o) => ({ ...thing, predicates: [...thing.predicates, ['rm-url', p, o]] })),
    removeAll:         vi.fn((thing, p)    => ({ ...thing, predicates: [...thing.predicates, ['rm-all', p]] })),
  };
});

vi.mock('@inrupt/solid-client', () => inrupt);

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeStubAuth(opts = {}) {
  return {
    getAuthenticatedFetch: opts.getAuthenticatedFetch ?? (() => globalThis.fetch),
    identity: () => 'test-identity',
    close: vi.fn(),
    ...opts,
  };
}

function makePodSource() {
  return {
    read:   vi.fn(),
    write:  vi.fn(),
    list:   vi.fn(),
    delete: vi.fn(),
    exists: vi.fn(),
  };
}

function podErr(code, message = 'mock error') {
  return Object.assign(new Error(message), { code });
}

function makeClient(podSource, auth = makeStubAuth()) {
  return new PodClient({
    podRoot: 'https://alice.example/',
    auth,
    podSourceFactory: () => podSource,
  });
}

// ── Constructor ──────────────────────────────────────────────────────────────

describe('PodClient — construction', () => {
  it('throws when podRoot is missing', () => {
    expect(() => new PodClient({ auth: makeStubAuth() })).toThrow(/podRoot is required/);
  });

  it('throws when auth is missing', () => {
    expect(() => new PodClient({ podRoot: 'https://x/' })).toThrow(/auth is required/);
  });

  it('uses a custom podSourceFactory when supplied', () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    expect(client.source).toBe(ps);
  });
});

// ── read ─────────────────────────────────────────────────────────────────────

describe('PodClient.read', () => {
  let ps, client;
  beforeEach(() => { ps = makePodSource(); client = makeClient(ps); });

  it('returns content as bytes by default for binary content', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    ps.read.mockResolvedValue({ content: bytes, contentType: 'application/octet-stream', lastModified: 'x', etag: '"e1"', size: 4 });
    const r = await client.read('/blob.bin');
    expect(r.content).toBeInstanceOf(Uint8Array);
    expect(r.contentType).toBe('application/octet-stream');
    expect(r.etag).toBe('"e1"');
  });

  it('decodes text/* to a string by default (auto)', async () => {
    const bytes = new TextEncoder().encode('hello');
    ps.read.mockResolvedValue({ content: bytes, contentType: 'text/plain', lastModified: 'x', etag: '"e2"', size: 5 });
    const r = await client.read('/note.txt');
    expect(r.content).toBe('hello');
  });

  it('decodes JSON bodies on auto', async () => {
    const obj   = { a: 1 };
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    ps.read.mockResolvedValue({ content: bytes, contentType: 'application/json', lastModified: 'x', etag: '"e3"', size: bytes.byteLength });
    const r = await client.read('/data.json');
    expect(r.content).toEqual(obj);
  });

  it('honours decode: bytes', async () => {
    const bytes = new TextEncoder().encode('hello');
    ps.read.mockResolvedValue({ content: bytes, contentType: 'text/plain', lastModified: 'x', etag: '"e4"', size: 5 });
    const r = await client.read('/note.txt', { decode: 'bytes' });
    expect(r.content).toBe(bytes);
  });

  it('honours decode: json', async () => {
    const bytes = new TextEncoder().encode('{"x":42}');
    ps.read.mockResolvedValue({ content: bytes, contentType: 'text/plain', lastModified: 'x', etag: '"e5"', size: bytes.byteLength });
    const r = await client.read('/x.txt', { decode: 'json' });
    expect(r.content).toEqual({ x: 42 });
  });

  it('captures etag/lastModified into the per-resource map', async () => {
    ps.read.mockResolvedValue({ content: new Uint8Array(), contentType: 'text/plain', lastModified: 'WED', etag: '"abc"', size: 0 });
    await client.read('/x');
    expect(client._etagMap.get('/x')).toEqual({ etag: '"abc"', lastModified: 'WED' });
  });

  it('maps NOT_FOUND → NotFoundError', async () => {
    ps.read.mockRejectedValue(podErr('NOT_FOUND', 'gone'));
    await expect(client.read('/x')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps UNAUTHORIZED → AuthError', async () => {
    ps.read.mockRejectedValue(podErr('UNAUTHORIZED'));
    await expect(client.read('/x')).rejects.toBeInstanceOf(AuthError);
  });

  it('maps FORBIDDEN → CapabilityError', async () => {
    ps.read.mockRejectedValue(podErr('FORBIDDEN'));
    await expect(client.read('/x')).rejects.toBeInstanceOf(CapabilityError);
  });

  it('maps SERVER_ERROR → NetworkError (retryable)', async () => {
    ps.read.mockRejectedValue(podErr('SERVER_ERROR'));
    const err = await client.read('/x').catch((e) => e);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.retryable).toBe(true);
  });

  it('maps RATE_LIMITED → PolicyError', async () => {
    ps.read.mockRejectedValue(podErr('RATE_LIMITED'));
    await expect(client.read('/x')).rejects.toBeInstanceOf(PolicyError);
  });

  it('maps unknown codes → base PodClientError, preserving raw code', async () => {
    ps.read.mockRejectedValue(podErr('WEIRD_THING'));
    const err = await client.read('/x').catch((e) => e);
    expect(err).toBeInstanceOf(PodClientError);
    expect(err.code).toBe('WEIRD_THING');
  });
});

// ── list ─────────────────────────────────────────────────────────────────────

describe('PodClient.list', () => {
  let ps, client;
  beforeEach(() => { ps = makePodSource(); client = makeClient(ps); });

  it('passes recursive through and returns the underlying entries shape', async () => {
    ps.list.mockResolvedValue({ container: '/c/', entries: [{ uri: '/c/a' }, { uri: '/c/b' }] });
    const r = await client.list('/c/', { recursive: true });
    expect(ps.list).toHaveBeenCalledWith('/c/', { recursive: true });
    expect(r.entries.length).toBe(2);
  });

  it('applies a filter when provided', async () => {
    ps.list.mockResolvedValue({ container: '/c/', entries: [{ uri: '/c/a.md' }, { uri: '/c/b.json' }] });
    const r = await client.list('/c/', { filter: (u) => u.endsWith('.md') });
    expect(r.entries.map((e) => e.uri)).toEqual(['/c/a.md']);
  });

  it('maps source errors', async () => {
    ps.list.mockRejectedValue(podErr('NOT_FOUND'));
    await expect(client.list('/c/')).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ── write ────────────────────────────────────────────────────────────────────

describe('PodClient.write', () => {
  let ps, client;
  beforeEach(() => { ps = makePodSource(); client = makeClient(ps); });

  it('writes a string with auto-attached If-Match from prior read', async () => {
    ps.read.mockResolvedValue({ content: new TextEncoder().encode('hi'), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 2 });
    await client.read('/n.md');
    ps.write.mockResolvedValue({ uri: '/n.md', contentType: 'text/plain', lastModified: 'y', etag: '"E2"', size: 5 });
    await client.write('/n.md', 'hello', { contentType: 'text/plain' });
    expect(ps.write).toHaveBeenCalledWith('/n.md', 'hello', expect.objectContaining({ contentType: 'text/plain', ifMatch: '"E1"' }));
  });

  it('skips If-Match when force: true', async () => {
    ps.read.mockResolvedValue({ content: new Uint8Array(), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 0 });
    await client.read('/n.md');
    ps.write.mockResolvedValue({ uri: '/n.md', contentType: 'text/plain', lastModified: 'y', etag: '"E2"', size: 1 });
    await client.write('/n.md', 'X', { contentType: 'text/plain', force: true });
    const opts = ps.write.mock.calls[0][2];
    expect(opts.ifMatch).toBeUndefined();
    expect(opts.force).toBeUndefined();
  });

  it('JSON-encodes plain objects and sets contentType to application/json', async () => {
    ps.write.mockResolvedValue({ uri: '/x.json', contentType: 'application/json', lastModified: 'y', etag: '"E3"', size: 7 });
    await client.write('/x.json', { a: 1 });
    expect(ps.write).toHaveBeenCalledWith('/x.json', JSON.stringify({ a: 1 }), expect.objectContaining({ contentType: 'application/json' }));
  });

  it('updates etag map on success', async () => {
    ps.write.mockResolvedValue({ uri: '/n.md', contentType: 'text/plain', lastModified: 'WED', etag: '"NEW"', size: 1 });
    await client.write('/n.md', 'X', { contentType: 'text/plain' });
    expect(client._etagMap.get('/n.md')).toEqual({ etag: '"NEW"', lastModified: 'WED' });
  });

  it('maps CONFLICT → ConflictError', async () => {
    ps.write.mockRejectedValue(podErr('CONFLICT'));
    await expect(client.write('/n.md', 'X')).rejects.toBeInstanceOf(ConflictError);
  });
});

// ── append ───────────────────────────────────────────────────────────────────

describe('PodClient.append', () => {
  let ps, client;
  beforeEach(() => { ps = makePodSource(); client = makeClient(ps); });

  it('reads, appends, writes — happy path', async () => {
    ps.read.mockResolvedValue({ content: new TextEncoder().encode('a\n'), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 2 });
    ps.write.mockResolvedValue({ uri: '/log', contentType: 'text/plain', lastModified: 'y', etag: '"E2"', size: 5 });
    await client.append('/log', 'b');
    expect(ps.write).toHaveBeenCalledWith('/log', 'a\nb\n', expect.any(Object));
  });

  it('starts fresh when the resource does not exist (404)', async () => {
    ps.read.mockRejectedValue(podErr('NOT_FOUND'));
    ps.write.mockResolvedValue({ uri: '/log', contentType: 'text/plain', lastModified: 'y', etag: '"E2"', size: 2 });
    await client.append('/log', 'first');
    expect(ps.write).toHaveBeenCalledWith('/log', 'first\n', expect.any(Object));
  });

  it('retries up to N times on conflict, succeeding eventually', async () => {
    ps.read.mockResolvedValue({ content: new TextEncoder().encode('a\n'), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 2 });
    ps.write
      .mockRejectedValueOnce(podErr('CONFLICT'))
      .mockResolvedValueOnce({ uri: '/log', contentType: 'text/plain', lastModified: 'y', etag: '"E2"', size: 5 });
    await client.append('/log', 'b');
    expect(ps.write).toHaveBeenCalledTimes(2);
  });

  it('throws ConflictError with CONFLICT_RETRY_EXHAUSTED when retries exhaust', async () => {
    ps.read.mockResolvedValue({ content: new Uint8Array(), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 0 });
    ps.write.mockRejectedValue(podErr('CONFLICT'));
    const err = await client.append('/log', 'x', { retries: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT_RETRY_EXHAUSTED');
    // retries=1 → up to 2 total attempts
    expect(ps.write).toHaveBeenCalledTimes(2);
  });
});

// ── patch ────────────────────────────────────────────────────────────────────

describe('PodClient.patch', () => {
  let ps, client;
  beforeEach(() => {
    ps = makePodSource();
    client = makeClient(ps);
    inrupt.getSolidDataset.mockReset().mockResolvedValue({ id: 'ds' });
    inrupt.saveSolidDatasetAt.mockReset().mockResolvedValue({ id: 'ds-saved' });
    inrupt.getThing.mockReset().mockReturnValue(null);
    inrupt.createThing.mockClear();
    inrupt.addUrl.mockClear();
    inrupt.addStringNoLocale.mockClear();
    inrupt.removeUrl.mockClear();
    inrupt.removeAll.mockClear();
    inrupt.setThing.mockClear();
  });

  it('applies add-quad URL triples and saves', async () => {
    await client.patch('https://alice.example/x#me', {
      add: [{ predicate: 'https://schema.org/knows', object: 'https://bob.example/p#me' }],
    });
    expect(inrupt.getSolidDataset).toHaveBeenCalledWith('https://alice.example/x#me', expect.any(Object));
    expect(inrupt.addUrl).toHaveBeenCalledWith(expect.any(Object), 'https://schema.org/knows', 'https://bob.example/p#me');
    expect(inrupt.saveSolidDatasetAt).toHaveBeenCalled();
  });

  it('applies add-quad string-literal triples', async () => {
    await client.patch('https://alice.example/x#me', {
      add: [{ predicate: 'https://schema.org/name', object: 'Alice', datatype: 'string' }],
    });
    expect(inrupt.addStringNoLocale).toHaveBeenCalledWith(expect.any(Object), 'https://schema.org/name', 'Alice');
  });

  it('applies remove triples (URL)', async () => {
    await client.patch('https://alice.example/x#me', {
      remove: [{ predicate: 'https://schema.org/knows', object: 'https://bob.example/p#me' }],
    });
    expect(inrupt.removeUrl).toHaveBeenCalledWith(expect.any(Object), 'https://schema.org/knows', 'https://bob.example/p#me');
  });

  it('honours a custom applyFn that mutates the dataset', async () => {
    const applyFn = vi.fn((ds) => ({ ...ds, custom: true }));
    await client.patch('/x', { applyFn });
    expect(applyFn).toHaveBeenCalled();
    expect(inrupt.saveSolidDatasetAt).toHaveBeenCalledWith('/x', expect.objectContaining({ custom: true }), expect.any(Object));
  });

  it('maps source errors from getSolidDataset', async () => {
    inrupt.getSolidDataset.mockRejectedValue(podErr('NOT_FOUND'));
    await expect(client.patch('/x', { add: [] })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('maps source errors from saveSolidDatasetAt', async () => {
    inrupt.saveSolidDatasetAt.mockRejectedValue(podErr('CONFLICT'));
    await expect(client.patch('/x', { add: [{ predicate: 'p', object: 'o' }] })).rejects.toBeInstanceOf(ConflictError);
  });
});

// ── error mapping coverage ───────────────────────────────────────────────────

describe('PodClient — error code → subclass mapping', () => {
  let ps, client;
  beforeEach(() => { ps = makePodSource(); client = makeClient(ps); });

  const cases = [
    ['NOT_FOUND',         NotFoundError],
    ['UNAUTHORIZED',      AuthError],
    ['FORBIDDEN',         CapabilityError],
    ['CONFLICT',          ConflictError],
    ['RATE_LIMITED',      PolicyError],
    ['SERVER_ERROR',      NetworkError],
    ['HTTP_ERROR',        NetworkError],
    ['NETWORK_ERROR',     NetworkError],
    ['HASH_MISMATCH',     ConventionError],
    ['INVALID_MANIFEST',  ConventionError],
  ];

  for (const [code, Cls] of cases) {
    it(`maps ${code} → ${Cls.name}`, async () => {
      ps.read.mockRejectedValue(podErr(code));
      await expect(client.read('/x')).rejects.toBeInstanceOf(Cls);
    });
  }
});

// ── delete ───────────────────────────────────────────────────────────────────

describe('PodClient.delete', () => {
  let ps, client;
  beforeEach(() => { ps = makePodSource(); client = makeClient(ps); });

  it('attaches If-Match from prior read; clears the etag on success', async () => {
    ps.read.mockResolvedValue({ content: new Uint8Array(), contentType: 'text/plain', lastModified: 'x', etag: '"E1"', size: 0 });
    await client.read('/x');
    ps.delete.mockResolvedValue();
    await client.delete('/x');
    expect(ps.delete).toHaveBeenCalledWith('/x', expect.objectContaining({ ifMatch: '"E1"' }));
    expect(client._etagMap.get('/x')).toBeUndefined();
  });
});

// ── lifecycle ────────────────────────────────────────────────────────────────

describe('PodClient — lifecycle', () => {
  it('close() is idempotent and propagates to auth.close', async () => {
    const ps   = makePodSource();
    const auth = makeStubAuth();
    const client = makeClient(ps, auth);
    await client.close();
    await client.close();
    expect(auth.close).toHaveBeenCalledTimes(1);
  });

  it('rejects calls after close()', async () => {
    const client = makeClient(makePodSource());
    await client.close();
    await expect(client.read('/x')).rejects.toThrow(/closed/);
  });
});
