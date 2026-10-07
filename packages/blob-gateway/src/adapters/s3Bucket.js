// s3Bucket.js — the REAL bucket adapter satisfying the v0 `bucket` contract:
//
//   { put(key, bytes) => Promise, get(key) => Promise<string|null>, presign(key, {ttl}) => Promise<url>, delete(key) => Promise }
//
// over the S3 REST API with SigV4 signing. Works with AWS S3 AND S3-compatible
// hosts (Cloudflare R2, MinIO, Backblaze B2 S3) by pointing `endpoint` at them.
//
//   createS3Bucket({ endpoint, region, bucket, accessKeyId, secretAccessKey, fetch? })
//
// `fetch` is INJECTED so the adapter is testable against a recorded/stub S3 with
// no live account. `presign` returns a SigV4 pre-signed GET URL — the same
// short-lived-URL-to-ciphertext the gatekeeper hands out; the object at rest is
// the sealing envelope from uploadBlob (ciphertext-at-rest is preserved: this
// adapter never decrypts, it just moves opaque bytes).

import { signRequest, presignGetUrl, presignPutUrl } from './sigv4.js';

export function createS3Bucket({
  endpoint, region, bucket, accessKeyId, secretAccessKey,
  fetch: fetchImpl, service = 's3', now,
} = {}) {
  for (const [name, val] of Object.entries({ endpoint, region, bucket, accessKeyId, secretAccessKey })) {
    if (!val || typeof val !== 'string') {
      throw new Error(`createS3Bucket: \`${name}\` is required`);
    }
  }
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new Error('createS3Bucket: a `fetch` implementation is required (inject one, or run where globalThis.fetch exists)');
  }

  const cfg = { endpoint, region, bucket, accessKeyId, secretAccessKey, service };
  const dateNow = () => (typeof now === 'function' ? now() : new Date());

  return {
    /** PUT the (cipher)bytes at `key`. Signs with SigV4 header auth. */
    async put(key, bytes) {
      const payload = bytes ?? '';
      const { url, headers } = signRequest({ ...cfg, method: 'PUT', key, payload, date: dateNow() });
      const res = await doFetch(url, { method: 'PUT', headers, body: payload });
      if (!res || res.ok !== true) {
        throw new Error(`s3Bucket.put: upload failed for "${key}" (status ${res?.status ?? '??'})`);
      }
      return { key, etag: res.headers?.get?.('etag') ?? null };
    },

    /** GET the (cipher)bytes at `key` as text, or null when there is none (a host that opens at serve time). */
    async get(key) {
      const { url, headers } = signRequest({ ...cfg, method: 'GET', key, payload: '', date: dateNow() });
      const res = await doFetch(url, { method: 'GET', headers });
      if (res?.status === 404) return null;
      if (!res || res.ok !== true) throw new Error(`s3Bucket.get: read failed for "${key}" (status ${res?.status ?? '??'})`);
      return res.text();
    },

    /** A short-lived SigV4 pre-signed GET URL to the ciphertext. */
    async presign(key, { ttl } = {}) {
      const expiresIn = Number.isFinite(ttl) ? ttl : 60;
      return presignGetUrl({ ...cfg, key, expiresIn, date: dateNow() });
    },

    /** A short-lived SigV4 pre-signed PUT URL — a credential-less client uploads
     *  the sealed bytes straight to R2/S3 (the edge issues this; it never sees
     *  the object bytes). The object at rest is the sealing envelope. */
    async presignPut(key, { ttl } = {}) {
      const expiresIn = Number.isFinite(ttl) ? ttl : 60;
      return presignPutUrl({ ...cfg, key, expiresIn, date: dateNow() });
    },

    /** DELETE the object. A 404 is treated as already-gone (idempotent). */
    async delete(key) {
      const { url, headers } = signRequest({ ...cfg, method: 'DELETE', key, payload: '', date: dateNow() });
      const res = await doFetch(url, { method: 'DELETE', headers });
      if (res && (res.ok === true || res.status === 404)) return;
      throw new Error(`s3Bucket.delete: delete failed for "${key}" (status ${res?.status ?? '??'})`);
    },
  };
}
