/**
 * SolidPodSource — unit tests with mocked fetch.
 *
 * Covers happy paths plus the four error codes the pod-client mapper
 * cares about: 404 (NOT_FOUND), 401 (UNAUTHORIZED), 412 (CONFLICT),
 * 500 (SERVER_ERROR), plus 403 (FORBIDDEN), 429 (RATE_LIMITED) and a
 * raw-fetch failure (NETWORK_ERROR).
 *
 * We mock at the global-fetch level rather than mocking the Inrupt
 * module, because that exercises real Inrupt-side error mapping and
 * keeps these tests robust to Inrupt internal refactors.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SolidPodSource } from '../src/SolidPodSource.js';

const POD = 'https://pod.example.org/';

/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * Build a `Response` shim suitable to feed Inrupt's `getFile` /
 * `overwriteFile` / `deleteFile` and our own HEAD/PUT/DELETE paths.
 */
function makeRes({
  status = 200,
  statusText = 'OK',
  body = '',
  headers = {},
  contentType = 'text/plain',
  url = `${POD}foo.txt`,
} = {}) {
  // 204 / 205 / 304 may not have a body per the Fetch spec; undici enforces
  // this strictly.  Drop the body for those statuses.
  const noBodyStatus = status === 204 || status === 205 || status === 304;
  const hdrs = new Headers(headers);
  if (!noBodyStatus && contentType && !hdrs.has('content-type')) {
    hdrs.set('content-type', contentType);
  }
  // Use the platform Response so `response.blob()`, `.text()`, and
  // `.clone()` (used by Inrupt) all behave correctly.
  const res = new Response(noBodyStatus ? null : body, { status, statusText, headers: hdrs });
  // Response.url isn't writable; stub it with a defineProperty.
  try { Object.defineProperty(res, 'url', { value: url }); } catch { /* ignore */ }
  return res;
}

/**
 * Build a fetch mock that dispatches by `(method, url) → handler`.
 * Each call records its (url, init) and returns whatever the matched
 * handler returns.  Falls through to a 404 if no handler matches.
 */
function makeFetch(routes) {
  const calls = [];
  const fetchFn = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    calls.push({ url: String(url), method, init });
    const handler = routes[`${method} ${url}`] ?? routes[url];
    if (!handler) {
      return makeRes({ status: 404, statusText: 'Not Found', url: String(url) });
    }
    return typeof handler === 'function'
      ? handler({ url: String(url), method, init })
      : handler;
  };
  fetchFn.calls = calls;
  return fetchFn;
}

/* ─────────────────────────────────────────────────────────────────────────── */

describe('SolidPodSource — read', () => {
  let source;
  beforeEach(() => { source = null; });

  it('happy path: returns content + metadata', async () => {
    const body = 'hello world';
    const fetchFn = makeFetch({
      [`GET ${POD}foo.txt`]: makeRes({
        body,
        contentType: 'text/plain',
        headers: { etag: '"abc"', 'last-modified': 'Wed, 28 Apr 2026 10:00:00 GMT' },
      }),
      [`HEAD ${POD}foo.txt`]: makeRes({
        body: '',
        contentType: 'text/plain',
        headers: { etag: '"abc"', 'last-modified': 'Wed, 28 Apr 2026 10:00:00 GMT' },
      }),
    });
    source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.read('/foo.txt');
    expect(result.contentType).toBe('text/plain');
    expect(result.size).toBe(body.length);
    expect(new TextDecoder().decode(result.content)).toBe(body);
    expect(result.etag).toBe('"abc"');
    expect(result.lastModified).toBe('Wed, 28 Apr 2026 10:00:00 GMT');
  });

  it('404 → NOT_FOUND', async () => {
    const fetchFn = makeFetch({
      [`GET ${POD}missing.txt`]: makeRes({ status: 404, statusText: 'Not Found' }),
    });
    source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.read('/missing.txt'))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('401 → UNAUTHORIZED', async () => {
    const fetchFn = makeFetch({
      [`GET ${POD}private.txt`]: makeRes({ status: 401, statusText: 'Unauthorized' }),
    });
    source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.read('/private.txt'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('500 → SERVER_ERROR', async () => {
    const fetchFn = makeFetch({
      [`GET ${POD}boom.txt`]: makeRes({ status: 500, statusText: 'Server Error' }),
    });
    source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.read('/boom.txt'))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });

  it('raw fetch throw → NETWORK_ERROR', async () => {
    const fetchFn = async () => { throw new Error('connection refused'); };
    source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.read('/anything.txt'))
      .rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('absolute URI bypasses podUrl', async () => {
    const fetchFn = makeFetch({
      [`GET https://other.example/x.txt`]: makeRes({ body: 'ok', contentType: 'text/plain' }),
      [`HEAD https://other.example/x.txt`]: makeRes({ body: '', contentType: 'text/plain' }),
    });
    source = new SolidPodSource({ fetch: fetchFn });
    const r = await source.read('https://other.example/x.txt');
    expect(new TextDecoder().decode(r.content)).toBe('ok');
  });

  it('throws INVALID_ARGUMENT for relative URI without podUrl', async () => {
    source = new SolidPodSource({ fetch: makeFetch({}) });
    await expect(source.read('/x.txt'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('fail-loud: refuses a non-http(s) scheme (logical key) instead of concatenating', async () => {
    // Regression: a `mem://` logical key was being string-joined onto
    // the pod root → `…/mem://…` → silent 404. Must throw, not 404.
    source = new SolidPodSource({ podUrl: POD, fetch: makeFetch({}) });
    await expect(source.read('mem://neighbourhood/items/x.json'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(source.write('pseudo-pod://dev/x', 'data'))
      .rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    // A normal relative path (colons mid-segment, no scheme) still resolves.
    const fetchFn = makeFetch({
      [`GET ${POD}neighbourhood/members/webid:local:abc`]: makeRes({ body: 'ok', contentType: 'text/plain' }),
      [`HEAD ${POD}neighbourhood/members/webid:local:abc`]: makeRes({ body: '', contentType: 'text/plain' }),
    });
    const s2 = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    const r = await s2.read('neighbourhood/members/webid:local:abc');
    expect(new TextDecoder().decode(r.content)).toBe('ok');
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('SolidPodSource — write', () => {
  it('happy path: PUT via Inrupt overwriteFile', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}note.txt`]: makeRes({
        status: 201,
        statusText: 'Created',
        headers: { etag: '"v1"', 'last-modified': 'now' },
      }),
      [`HEAD ${POD}note.txt`]: makeRes({
        headers: { etag: '"v1"', 'last-modified': 'now' },
      }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.write('/note.txt', 'hello', { contentType: 'text/plain' });
    expect(result.uri).toBe(`${POD}note.txt`);
    expect(result.contentType).toBe('text/plain');
    // PUT was issued
    const put = fetchFn.calls.find(c => c.method === 'PUT');
    expect(put).toBeTruthy();
  });

  it('honours If-Match — happy path 200', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}note.txt`]: ({ init }) => {
        // If-Match must have been forwarded.
        const ifMatch = init?.headers?.['If-Match'];
        if (ifMatch !== '"abc"') {
          return makeRes({ status: 400, statusText: 'Bad Request' });
        }
        return makeRes({
          status: 204, statusText: 'No Content',
          headers: { etag: '"def"', 'last-modified': 'later' },
        });
      },
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.write('/note.txt', 'hello', {
      contentType: 'text/plain',
      ifMatch:     '"abc"',
    });
    expect(result.etag).toBe('"def"');
  });

  it('412 with If-Match → CONFLICT', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}note.txt`]: makeRes({ status: 412, statusText: 'Precondition Failed' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    await expect(
      source.write('/note.txt', 'hello', { contentType: 'text/plain', ifMatch: '"stale"' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 412 });
  });

  it('403 → FORBIDDEN', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}private.txt`]: makeRes({ status: 403, statusText: 'Forbidden' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.write('/private.txt', 'x', { contentType: 'text/plain' }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('429 → RATE_LIMITED', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}note.txt`]: makeRes({ status: 429, statusText: 'Too Many Requests' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.write('/note.txt', 'x', { contentType: 'text/plain' }))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('Uint8Array input is accepted', async () => {
    const fetchFn = makeFetch({
      [`PUT ${POD}b.bin`]: makeRes({ status: 201 }),
      [`HEAD ${POD}b.bin`]: makeRes({}),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const r = await source.write('/b.bin', bytes, { contentType: 'application/octet-stream' });
    expect(r.size).toBe(4);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('SolidPodSource — delete', () => {
  it('happy path', async () => {
    const fetchFn = makeFetch({
      [`DELETE ${POD}gone.txt`]: makeRes({ status: 204, statusText: 'No Content' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.delete('/gone.txt')).resolves.toBeUndefined();
  });

  it('404 is a no-op (DataSource semantics)', async () => {
    const fetchFn = makeFetch({
      [`DELETE ${POD}ghost.txt`]: makeRes({ status: 404, statusText: 'Not Found' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.delete('/ghost.txt')).resolves.toBeUndefined();
  });

  it('honours If-Match: 412 → CONFLICT', async () => {
    const fetchFn = makeFetch({
      [`DELETE ${POD}note.txt`]: makeRes({ status: 412, statusText: 'Precondition Failed' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.delete('/note.txt', { ifMatch: '"stale"' }))
      .rejects.toMatchObject({ code: 'CONFLICT', status: 412 });
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('SolidPodSource — list', () => {
  it('returns container entries', async () => {
    // Inrupt's getSolidDataset parses Turtle; respond with a container
    // listing using `ldp:contains`.
    const turtle = `
      @prefix ldp:  <http://www.w3.org/ns/ldp#> .
      @prefix dcterms: <http://purl.org/dc/terms/> .
      <${POD}notes/> a ldp:Container, ldp:BasicContainer ;
        ldp:contains <${POD}notes/a.md>, <${POD}notes/b.md>, <${POD}notes/sub/> .
    `;
    const fetchFn = makeFetch({
      [`GET ${POD}notes/`]: makeRes({
        body:        turtle,
        contentType: 'text/turtle',
        url:         `${POD}notes/`,
      }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.list('/notes/');
    expect(result.container).toBe(`${POD}notes/`);
    const uris = result.entries.map(e => e.uri).sort();
    expect(uris).toEqual([`${POD}notes/a.md`, `${POD}notes/b.md`, `${POD}notes/sub/`]);
    const sub = result.entries.find(e => e.uri.endsWith('/sub/'));
    expect(sub.type).toBe('container');
    const a = result.entries.find(e => e.uri.endsWith('/a.md'));
    expect(a.type).toBe('resource');
  });

  it('appends trailing slash', async () => {
    const turtle = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${POD}notes/> a ldp:Container .
    `;
    const fetchFn = makeFetch({
      [`GET ${POD}notes/`]: makeRes({
        body:        turtle,
        contentType: 'text/turtle',
        url:         `${POD}notes/`,
      }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    const result = await source.list('/notes');
    expect(result.container).toBe(`${POD}notes/`);
  });

  it('404 → NOT_FOUND', async () => {
    const fetchFn = makeFetch({
      [`GET ${POD}missing/`]: makeRes({ status: 404, statusText: 'Not Found' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.list('/missing/')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('recursive: true descends into child containers and flattens', async () => {
    const root = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${POD}notes/> a ldp:Container, ldp:BasicContainer ;
        ldp:contains <${POD}notes/a.md>, <${POD}notes/sub/> .
    `;
    const sub = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${POD}notes/sub/> a ldp:Container, ldp:BasicContainer ;
        ldp:contains <${POD}notes/sub/c.md>, <${POD}notes/sub/deep/> .
    `;
    const deep = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${POD}notes/sub/deep/> a ldp:Container, ldp:BasicContainer ;
        ldp:contains <${POD}notes/sub/deep/d.md> .
    `;
    const fetchFn = makeFetch({
      [`GET ${POD}notes/`]:          makeRes({ body: root, contentType: 'text/turtle', url: `${POD}notes/` }),
      [`GET ${POD}notes/sub/`]:      makeRes({ body: sub,  contentType: 'text/turtle', url: `${POD}notes/sub/` }),
      [`GET ${POD}notes/sub/deep/`]: makeRes({ body: deep, contentType: 'text/turtle', url: `${POD}notes/sub/deep/` }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.list('/notes/', { recursive: true });
    const uris = result.entries.map((e) => e.uri).sort();
    expect(uris).toEqual([
      `${POD}notes/a.md`,
      `${POD}notes/sub/`,
      `${POD}notes/sub/c.md`,
      `${POD}notes/sub/deep/`,
      `${POD}notes/sub/deep/d.md`,
    ]);
  });

  it('recursive: skips mid-walk 404s on child containers', async () => {
    const root = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${POD}notes/> a ldp:Container ;
        ldp:contains <${POD}notes/a.md>, <${POD}notes/gone/> .
    `;
    const fetchFn = makeFetch({
      [`GET ${POD}notes/`]:     makeRes({ body: root, contentType: 'text/turtle', url: `${POD}notes/` }),
      [`GET ${POD}notes/gone/`]: makeRes({ status: 404, statusText: 'Not Found' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.list('/notes/', { recursive: true });
    const uris = result.entries.map((e) => e.uri).sort();
    // Race-deleted child container's contents are absent; the container
    // itself remains in the parent listing.
    expect(uris).toEqual([`${POD}notes/a.md`, `${POD}notes/gone/`]);
  });

  it('recursive: false (default) returns one level only', async () => {
    const root = `
      @prefix ldp: <http://www.w3.org/ns/ldp#> .
      <${POD}notes/> a ldp:Container ;
        ldp:contains <${POD}notes/a.md>, <${POD}notes/sub/> .
    `;
    // Note: NO handler for /notes/sub/ — verifies we don't recurse.
    const fetchFn = makeFetch({
      [`GET ${POD}notes/`]: makeRes({ body: root, contentType: 'text/turtle', url: `${POD}notes/` }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });

    const result = await source.list('/notes/');   // no opts
    const uris = result.entries.map((e) => e.uri).sort();
    expect(uris).toEqual([`${POD}notes/a.md`, `${POD}notes/sub/`]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('SolidPodSource — exists', () => {
  it('200 → true', async () => {
    const fetchFn = makeFetch({
      [`HEAD ${POD}foo.txt`]: makeRes({ status: 200, body: '' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    expect(await source.exists('/foo.txt')).toBe(true);
  });

  it('404 → false', async () => {
    const fetchFn = makeFetch({
      [`HEAD ${POD}missing.txt`]: makeRes({ status: 404, statusText: 'Not Found' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    expect(await source.exists('/missing.txt')).toBe(false);
  });

  it('401 → throws UNAUTHORIZED', async () => {
    const fetchFn = makeFetch({
      [`HEAD ${POD}private.txt`]: makeRes({ status: 401, statusText: 'Unauthorized' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.exists('/private.txt'))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('500 → throws SERVER_ERROR', async () => {
    const fetchFn = makeFetch({
      [`HEAD ${POD}boom.txt`]: makeRes({ status: 500, statusText: 'Server Error' }),
    });
    const source = new SolidPodSource({ podUrl: POD, fetch: fetchFn });
    await expect(source.exists('/boom.txt'))
      .rejects.toMatchObject({ code: 'SERVER_ERROR' });
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */

describe('SolidPodSource — constructor', () => {
  it('accepts the legacy `credential` field for backwards compat (ignored)', () => {
    expect(() => new SolidPodSource({ podUrl: POD, credential: 'tok' }))
      .not.toThrow();
  });

  it('podUrl is exposed via getter', () => {
    const s = new SolidPodSource({ podUrl: POD });
    expect(s.podUrl).toBe(POD);
  });

  it('falls back to globalThis.fetch when no fetch passed', () => {
    const s = new SolidPodSource({ podUrl: POD });
    // Don't call it — just confirm construction doesn't throw.
    expect(s).toBeInstanceOf(SolidPodSource);
  });
});

// Smoke assertions relocated from @onderling/core's `test/storage.test.js`
// when SolidPodSource moved out of core into @onderling/pod-client.
describe('SolidPodSource (smoke)', () => {
  it('exposes the DataSource API and the new `exists` method', () => {
    const s = new SolidPodSource({ podUrl: 'https://pod.example.org/' });
    expect(typeof s.read).toBe('function');
    expect(typeof s.write).toBe('function');
    expect(typeof s.delete).toBe('function');
    expect(typeof s.list).toBe('function');
    expect(typeof s.exists).toBe('function');
    expect(s.podUrl).toBe('https://pod.example.org/');
  });

  it('query() throws INVALID_ARGUMENT (not supported on LDP)', async () => {
    const s = new SolidPodSource({ podUrl: 'https://pod.example.org/' });
    await expect(s.query({})).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
