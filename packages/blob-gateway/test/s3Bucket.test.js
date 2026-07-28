import { describe, it, expect } from 'vitest';
import { createS3Bucket } from '../src/adapters/s3Bucket.js';
import { signingKey, presignGetUrl } from '../src/adapters/sigv4.js';

const CFG = {
  endpoint: 'https://s3.us-east-1.amazonaws.com',
  region: 'us-east-1',
  bucket: 'onderling-blobs',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
};

/** A stub fetch that records the last call and returns a canned response. */
function stubFetch(response = { ok: true, status: 200 }) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, init });
    return {
      ok: response.ok,
      status: response.status,
      headers: { get: (h) => (h.toLowerCase() === 'etag' ? '"abc123"' : null) },
    };
  };
  fn.calls = calls;
  return fn;
}

describe('sigv4 — signing correctness (offline AWS test vector)', () => {
  it('derives the documented SigV4 signing key', () => {
    // AWS "Examples of how to derive a signing key" reference vector.
    const key = signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam');
    expect(key.toString('hex'))
      .toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });
});

describe('createS3Bucket — put', () => {
  it('PUTs to the right object URL with a SigV4 Authorization header', async () => {
    const fetch = stubFetch();
    const bucket = createS3Bucket({ ...CFG, fetch, now: () => new Date('2026-07-06T12:00:00Z') });

    const res = await bucket.put('objkey123', 'SEALED-CIPHERTEXT');

    expect(fetch.calls).toHaveLength(1);
    const { url, init } = fetch.calls[0];
    expect(init.method).toBe('PUT');
    expect(url).toBe('https://s3.us-east-1.amazonaws.com/onderling-blobs/objkey123');
    expect(init.body).toBe('SEALED-CIPHERTEXT');

    // SigV4 auth header shape.
    const auth = init.headers.authorization;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(auth).toContain('Credential=AKIAIOSFODNN7EXAMPLE/20260706/us-east-1/s3/aws4_request');
    expect(auth).toMatch(/SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/);
    // Body integrity header present + the amz date.
    expect(init.headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
    expect(init.headers['x-amz-date']).toBe('20260706T120000Z');
    expect(res.etag).toBe('"abc123"');
  });

  it('throws on a non-ok upload (never silently succeeds)', async () => {
    const fetch = stubFetch({ ok: false, status: 403 });
    const bucket = createS3Bucket({ ...CFG, fetch });
    await expect(bucket.put('k', 'x')).rejects.toThrow(/upload failed .*403/);
  });
});

describe('createS3Bucket — presign', () => {
  it('yields a valid pre-signed GET URL with the ttl expiry query params', async () => {
    const bucket = createS3Bucket({ ...CFG, fetch: stubFetch(), now: () => new Date('2026-07-06T12:00:00Z') });
    const url = await bucket.presign('objkey123', { ttl: 120 });

    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://s3.us-east-1.amazonaws.com/onderling-blobs/objkey123');
    expect(u.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
    expect(u.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(u.searchParams.get('X-Amz-Date')).toBe('20260706T120000Z');
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
    expect(u.searchParams.get('X-Amz-Credential'))
      .toBe('AKIAIOSFODNN7EXAMPLE/20260706/us-east-1/s3/aws4_request');
    expect(u.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('defaults to a 60s ttl and is deterministic for a fixed clock', async () => {
    const at = () => new Date('2026-07-06T12:00:00Z');
    const a = presignGetUrl({ ...CFG, key: 'k', date: at() });
    const b = presignGetUrl({ ...CFG, key: 'k', date: at() });
    expect(a).toBe(b); // same inputs → same signature (no hidden nonce)
    expect(new URL(a).searchParams.get('X-Amz-Expires')).toBe('60');
    // A different ttl changes the signature (expiry is signed).
    const c = presignGetUrl({ ...CFG, key: 'k', expiresIn: 61, date: at() });
    expect(new URL(c).searchParams.get('X-Amz-Signature'))
      .not.toBe(new URL(a).searchParams.get('X-Amz-Signature'));
  });

  it('presignPut yields a PUT-method URL, differently signed from the GET one', async () => {
    const bucket = createS3Bucket({ ...CFG, fetch: stubFetch(), now: () => new Date('2026-07-06T12:00:00Z') });
    const putUrl = await bucket.presignPut('objkey123', { ttl: 120 });
    const getUrl = await bucket.presign('objkey123', { ttl: 120 });

    const p = new URL(putUrl);
    expect(p.origin + p.pathname).toBe('https://s3.us-east-1.amazonaws.com/onderling-blobs/objkey123');
    expect(p.searchParams.get('X-Amz-Expires')).toBe('120');
    // The HTTP method is part of the SigV4 canonical request → PUT ≠ GET signature.
    expect(p.searchParams.get('X-Amz-Signature'))
      .not.toBe(new URL(getUrl).searchParams.get('X-Amz-Signature'));
    expect(p.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('works against an S3-compatible endpoint (e.g. R2/MinIO) via `endpoint`', async () => {
    const bucket = createS3Bucket({
      ...CFG, endpoint: 'https://acct.r2.cloudflarestorage.com', region: 'auto',
      fetch: stubFetch(), now: () => new Date('2026-07-06T12:00:00Z'),
    });
    const url = await bucket.presign('k', { ttl: 30 });
    expect(url.startsWith('https://acct.r2.cloudflarestorage.com/onderling-blobs/k?')).toBe(true);
    expect(new URL(url).searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
  });
});

describe('createS3Bucket — delete', () => {
  it('signs + DELETEs the object', async () => {
    const fetch = stubFetch({ ok: true, status: 204 });
    const bucket = createS3Bucket({ ...CFG, fetch });
    await bucket.delete('objkey123');
    const { url, init } = fetch.calls[0];
    expect(init.method).toBe('DELETE');
    expect(url).toBe('https://s3.us-east-1.amazonaws.com/onderling-blobs/objkey123');
    expect(init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 /);
  });

  it('treats a 404 as already-gone (idempotent), throws on other errors', async () => {
    const gone = createS3Bucket({ ...CFG, fetch: stubFetch({ ok: false, status: 404 }) });
    await expect(gone.delete('k')).resolves.toBeUndefined();
    const err = createS3Bucket({ ...CFG, fetch: stubFetch({ ok: false, status: 500 }) });
    await expect(err.delete('k')).rejects.toThrow(/delete failed .*500/);
  });
});

describe('createS3Bucket — config validation', () => {
  it('requires all S3 credentials', () => {
    expect(() => createS3Bucket({ ...CFG, endpoint: undefined, fetch: stubFetch() }))
      .toThrow(/endpoint/);
    expect(() => createS3Bucket({ ...CFG, secretAccessKey: undefined, fetch: stubFetch() }))
      .toThrow(/secretAccessKey/);
  });
});
