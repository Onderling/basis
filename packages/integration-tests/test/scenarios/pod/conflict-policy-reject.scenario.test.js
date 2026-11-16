/**
 * Scenario: pod/conflict-policy-reject
 *
 * Story: Two writers race on the same URI.  The first write succeeds and
 * stores an etag.  The second writer holds a stale etag and writes —
 * MUST throw `ConflictError` under the default `conflictPolicy: 'reject'`
 * (locked Q-A.4 default).  No silent overwrite — the resource on the pod
 * still has the first writer's content.
 *
 * Lab setup: a single MockPod that both writers share, fronted by two
 * separate PodClient instances (so each has its own etag map and
 * the conflict path actually fires).
 *
 * Action:
 *   1. Alice writes /notes/x.md → success. She remembers WHAT she wrote (a digest), never an
 *      ETag: a pod answers a PUT with none (L936).
 *   2. Bob's PodClient reads the same URI → his read's ETag is his condition.
 *   3. Alice writes again → her client first reads the resource (lazy check: still what she
 *      wrote) and sends If-Match with that read's ETag → success, the ETag advances.
 *   4. Bob writes (his ETag is now stale) → MockPod returns 412/CONFLICT
 *      → PodClient bubbles a ConflictError because no listener attached.
 *   And the other order: Bob writes after Alice's write without reading → Alice's next
 *   default write sees the body is no longer hers → ConflictError before any PUT.
 *
 * Assertion:
 *   - The stale write rejects with ConflictError (instance + .code).
 *   - The pod still holds the other writer's content (no silent overwrite).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PodClient, ConflictError } from '@onderling/pod-client';
import { MockPod } from '../../../src/_harness/index.js';

const POD_ROOT = 'https://alice.example/';
const URI      = POD_ROOT + 'notes/x.md';

function makeStubAuth() {
  return {
    getAuthenticatedFetch: () => globalThis.fetch,
    identity: () => 'test-identity',
    close: () => {},
  };
}

/**
 * Wrap a MockPod in a SolidPodSource-shaped adapter PodClient can consume.
 * The pod-client always TextDecodes `read()` results, so we coerce string
 * content to Uint8Array on the way out (MockPod stores values verbatim).
 */
function makePodSourceFromMock(mock) {
  return {
    read: async (uri, opts) => {
      const r = await mock.read(uri, opts);
      const bytes =
        r.content instanceof Uint8Array
          ? r.content
          : typeof r.content === 'string'
          ? new TextEncoder().encode(r.content)
          : r.content instanceof ArrayBuffer
          ? new Uint8Array(r.content)
          : new TextEncoder().encode(JSON.stringify(r.content));
      return { ...r, content: bytes, size: bytes.byteLength };
    },
    write:  (uri, content, opts) => mock.write(uri, content, opts),
    list:   (container, opts)    => mock.list(container, opts),
    delete: (uri, opts)          => mock.delete(uri, opts),
    exists: (uri)                => mock.exists(uri),
  };
}

describe('pod/conflict-policy-reject', () => {
  let mock, alice, bob;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mock  = new MockPod();
    alice = new PodClient({
      podRoot: POD_ROOT,
      auth:    makeStubAuth(),
      podSourceFactory: () => makePodSourceFromMock(mock),
    });
    bob   = new PodClient({
      podRoot: POD_ROOT,
      auth:    makeStubAuth(),
      podSourceFactory: () => makePodSourceFromMock(mock),
    });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('default conflictPolicy is "reject" — concurrent write throws ConflictError; no silent overwrite', async () => {
    // 1. Alice writes the resource for the first time.
    const w1 = await alice.write(URI, 'alice-v1', { contentType: 'text/markdown' });

    // 2. Bob reads the resource: HIS condition is that read's ETag (etag_v1).
    const r = await bob.read(URI);
    expect(r.content).toBe('alice-v1');
    expect(r.etag).toBe(w1.etag);

    // 3. Alice writes again: her own earlier write is still what the pod holds, so it goes
    //    through (conditioned on the ETag her lazy check read) and the pod advances to etag_v2.
    const w2 = await alice.write(URI, 'alice-v2', { contentType: 'text/markdown' });
    expect(w2.etag).not.toBe(w1.etag);

    // 4. Bob writes — his ifMatch is the stale etag_v1.  No conflict listener
    //    is attached, so the no-listener fast-path throws ConflictError.
    const err = await bob.write(URI, 'bob-stomp', { contentType: 'text/markdown' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT');

    // 5. No silent overwrite — pod still holds Alice's v2 content.
    const post = await alice.read(URI);
    expect(post.content).toBe('alice-v2');
    expect(post.etag).toBe(w2.etag);
  });

  it('another writer lands after OUR write (we never read it): our next default write refuses; their change stays', async () => {
    await alice.write(URI, 'alice-v1', { contentType: 'text/markdown' });
    await bob.write(URI, 'bob-v1', { contentType: 'text/markdown' }); // Bob never read: a plain create-or-replace

    const err = await alice.write(URI, 'alice-v2', { contentType: 'text/markdown' }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT');
    expect((await bob.read(URI)).content).toBe('bob-v1');

    // after a read Alice builds on Bob's version and her write goes through
    await alice.read(URI);
    await alice.write(URI, 'alice-v2', { contentType: 'text/markdown' });
    expect((await bob.read(URI)).content).toBe('alice-v2');
  });

  it('explicit conflictPolicy: "reject" matches the default behaviour (defence-in-depth)', async () => {
    await alice.write(URI, 'alice-v1');
    await bob.read(URI);
    await alice.write(URI, 'alice-v2');

    const err = await bob.write(URI, 'bob-stomp', {
      contentType:    'text/markdown',
      conflictPolicy: 'reject',
    }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT');

    expect((await alice.read(URI)).content).toBe('alice-v2');
  });
});
