/**
 * WHAT A CLIENT REMEMBERS AFTER IT WRITES (L936 (a), Fable's ruling 2026-11-15). A pod answers a PUT with no ETag
 * (measured on CSS 7.2.0: 201/205, no ETag, no Last-Modified), so the version a write produced is not known from the write.
 * Before: the plain write took its ETag from a HEAD sent afterwards, so another writer's PUT in between made THEIR version
 * ours, and the next default write passed If-Match over their change (silent loss); and after any write the client kept
 * the ETag from BEFORE it, so its own next write got a 412 on its own change. Now the client remembers "I wrote this" as a
 * digest of the bytes it sent, and checks it LAZILY at the next default write or delete: one GET; the body is still ours →
 * that response's ETag is the condition; it is not → a ConflictError (the caller reads and merges), never an overwrite.
 * A write-once resource costs no extra request.
 */
import { describe, it, expect } from 'vitest';
import { PodClient, ConflictError } from '../src/index.js';

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);

/** A pod that behaves like CSS: a write answers with NO ETag; If-Match is checked; every request is counted. `afterOwnWrite`
 *  lets another writer land right after this client's PUT (before anything this client sends next). */
function fakePod() {
  const pod = { body: null, version: 0, calls: { read: 0, write: 0, delete: 0 }, afterOwnWrite: null };
  const etag = () => `"v${pod.version}"`;
  pod.other = (body) => { pod.body = enc(body); pod.version += 1; };
  pod.source = {
    async read() {
      pod.calls.read += 1;
      if (pod.body == null) throw Object.assign(new Error('nf'), { code: 'NOT_FOUND' });
      return { content: pod.body, contentType: 'text/plain', etag: etag(), lastModified: null, size: pod.body.length };
    },
    async write(uri, payload, opts = {}) {
      pod.calls.write += 1;
      if (opts.ifMatch && opts.ifMatch !== etag()) throw Object.assign(new Error('412'), { code: 'CONFLICT', status: 412 });
      pod.body = typeof payload === 'string' ? enc(payload) : payload;
      pod.version += 1;
      // a CONDITIONAL write answers with the PUT's own headers: no ETag (as CSS); the old PLAIN write sent a HEAD after
      // the PUT, which reports whatever is there by then
      const conditional = !!(opts.ifMatch || opts.ifNoneMatch || opts.ifUnmodifiedSince);
      if (pod.afterOwnWrite) { pod.afterOwnWrite(); pod.afterOwnWrite = null; }
      return { uri, contentType: 'text/plain', etag: conditional ? null : etag(), lastModified: null, size: null };
    },
    async delete(uri, opts = {}) {
      pod.calls.delete += 1;
      if (opts.ifMatch && opts.ifMatch !== etag()) throw Object.assign(new Error('412'), { code: 'CONFLICT', status: 412 });
      pod.body = null;
    },
    async list() { return { container: '', entries: [] }; },
    async exists() { return pod.body != null; },
  };
  return pod;
}

const client = (pod) => new PodClient({
  podRoot: 'https://pod.example/me/',
  auth: { getAuthenticatedFetch: () => globalThis.fetch, identity: () => 'me', close() {} },
  podSourceFactory: () => pod.source,
});

describe('after a write, the client remembers what it wrote, never a version it did not see', () => {
  it('another writer lands right after my write: my next write is refused (ConflictError), their change stays', async () => {
    const pod = fakePod();
    const c = client(pod);
    pod.afterOwnWrite = () => pod.other('theirs');      // their PUT between mine and anything I send next
    await c.write('/f.txt', 'mine-1');
    await expect(c.write('/f.txt', 'mine-2')).rejects.toBeInstanceOf(ConflictError);
    expect(dec(pod.body), 'their change is not overwritten').toBe('theirs');
  });

  it('my own second write to the same resource goes through (no 412 on my own change)', async () => {
    const pod = fakePod();
    pod.other('start');
    const c = client(pod);
    await c.read('/f.txt');                               // the client knows v1
    await c.write('/f.txt', 'mine-1');
    await c.write('/f.txt', 'mine-2');
    expect(dec(pod.body)).toBe('mine-2');
  });

  it('another writer wrote the SAME bytes: not a conflict', async () => {
    const pod = fakePod();
    const c = client(pod);
    await c.write('/f.txt', 'same');
    pod.other('same');
    await c.write('/f.txt', 'next');
    expect(dec(pod.body)).toBe('next');
  });

  it('a write-once resource costs no extra request', async () => {
    const pod = fakePod();
    const c = client(pod);
    await c.write('/f.txt', 'once');
    expect(pod.calls).toEqual({ read: 0, write: 1, delete: 0 });
  });

  it('the check is lazy: the second write pays one GET, and a read in between makes it free', async () => {
    const pod = fakePod();
    const c = client(pod);
    await c.write('/f.txt', 'a');
    await c.write('/f.txt', 'b');
    expect(pod.calls.read, 'one GET at the second write').toBe(1);
    await c.read('/f.txt');
    await c.write('/f.txt', 'c');
    expect(pod.calls.read, 'the read in between gave the version: no GET at the write').toBe(2);
  });

  it('a delete after my write checks the same way: another writer since → ConflictError, nothing deleted', async () => {
    const pod = fakePod();
    const c = client(pod);
    await c.write('/f.txt', 'mine');
    pod.other('theirs');
    await expect(c.delete('/f.txt')).rejects.toBeInstanceOf(ConflictError);
    expect(dec(pod.body)).toBe('theirs');
  });
});
