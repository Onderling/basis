/**
 * Conflict detection + resolution tests.
 *
 * @see Design-v3/pod-client-api.md §Conflict detection
 * @see coding-plans/track-A-pod-substrate.md §A7
 *
 * Locked Q-A.4 (2026-04-28):
 *   - Default `conflictPolicy` for `write` is `'reject'` (was `'lww'`).
 *   - `append` retry budget defaults to 3; per-call `retries` opt overrides.
 *   - `retries: 0` causes immediate error on first conflict.
 *
 * Tests use a stub `SolidPodSource` that lets us simulate stale-etag rejects
 * deterministically.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  PodClient,
  ConflictError,
  ConflictResolver,
} from '../src/index.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeStubAuth() {
  return {
    getAuthenticatedFetch: () => globalThis.fetch,
    identity: () => 'test-identity',
    close: vi.fn(),
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

function makeClient(ps, options = {}) {
  return new PodClient({
    podRoot: 'https://alice.example/',
    auth:    makeStubAuth(),
    podSourceFactory: () => ps,
    options: {
      // Short timeout so the "listener does nothing" path resolves fast in tests.
      conflictListenerTimeout: 50,
      ...options,
    },
  });
}

/**
 * Pre-populate the etag map for a URI.  Avoids relying on a prior read in
 * setups that focus on the conflict path itself.
 */
function seedEtag(client, uri, etag = '"local"', lastModified = 'L1') {
  client._etagMap.set(uri, { etag, lastModified });
}

// ── default policy: reject (Q-A.4 lock) ──────────────────────────────────────

describe('PodClient.write — default conflictPolicy is "reject" (Q-A.4)', () => {
  it('throws ConflictError on 412 with no listener and no policy override', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md');
    ps.write.mockRejectedValueOnce(podErr('CONFLICT'));
    // The reject path also fetches remote for the (un-emitted) event payload.
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('remote'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 6,
    });

    const err = await client.write('/n.md', 'local').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    // Only one underlying write attempted — the default policy did NOT retry.
    expect(ps.write).toHaveBeenCalledTimes(1);
  });
});

// ── conflictPolicy: 'lww' ────────────────────────────────────────────────────

describe('PodClient.write — conflictPolicy: "lww"', () => {
  it('retries with force: true after a 412 and resolves with the success payload', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md');
    ps.write
      .mockRejectedValueOnce(podErr('CONFLICT'))
      .mockResolvedValueOnce({ uri: '/n.md', contentType: 'text/plain', lastModified: 'R2', etag: '"forced"', size: 5 });
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('remote'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 6,
    });

    const res = await client.write('/n.md', 'local', { conflictPolicy: 'lww' });
    expect(res.etag).toBe('"forced"');
    expect(ps.write).toHaveBeenCalledTimes(2);
    // The retry must drop If-Match (force: true).
    const retryOpts = ps.write.mock.calls[1][2];
    expect(retryOpts.ifMatch).toBeUndefined();
    expect(retryOpts.force).toBeUndefined();
  });
});

// ── conflictPolicy: 'remote-wins' ────────────────────────────────────────────

describe('PodClient.write — conflictPolicy: "remote-wins"', () => {
  it('abandons the write and resolves with { skipped: true } shape', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md', '"local"', 'L1');
    ps.write.mockRejectedValueOnce(podErr('CONFLICT'));
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('remote'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 6,
    });

    const res = await client.write('/n.md', 'local', { conflictPolicy: 'remote-wins' });
    expect(res).toMatchObject({
      uri: '/n.md',
      etag: '"remote"',
      lastModified: 'R1',
      skipped: true,
      reason: 'remote-wins',
    });
    // No retry was issued.
    expect(ps.write).toHaveBeenCalledTimes(1);
    // Etag map refreshed from the remote.
    expect(client._etagMap.get('/n.md')).toEqual({ etag: '"remote"', lastModified: 'R1' });
  });
});

// ── listener-driven: resolveWith ─────────────────────────────────────────────

describe("PodClient — 'conflict' event with resolveWith()", () => {
  it('listener supplies merged content; client re-issues with force: true', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/notes/today.md');
    ps.write
      .mockRejectedValueOnce(podErr('CONFLICT'))
      .mockResolvedValueOnce({ uri: '/notes/today.md', contentType: 'text/markdown', lastModified: 'R2', etag: '"E-merged"', size: 12 });
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('remote text'),
      contentType: 'text/markdown',
      lastModified: 'R1',
      etag: '"remote"',
      size: 11,
    });

    const seen = [];
    client.on('conflict', (event) => {
      seen.push({
        uri: event.uri,
        local: event.localContent,
        remote: event.remoteContent,
        localLM: event.localLastModified,
        remoteLM: event.remoteLastModified,
      });
      event.resolveWith('merged content');
    });

    const res = await client.write('/notes/today.md', 'local text', { contentType: 'text/markdown' });
    expect(res.etag).toBe('"E-merged"');
    expect(seen).toEqual([{
      uri: '/notes/today.md',
      local: 'local text',
      remote: 'remote text',
      localLM: 'L1',
      remoteLM: 'R1',
    }]);
    // Second call carries the merged content.
    expect(ps.write).toHaveBeenNthCalledWith(2, '/notes/today.md', 'merged content', expect.any(Object));
    const retryOpts = ps.write.mock.calls[1][2];
    expect(retryOpts.ifMatch).toBeUndefined();
  });

  it('event payload exposes a ConflictResolver instance', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md');
    ps.write.mockRejectedValueOnce(podErr('CONFLICT'));
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('r'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 1,
    });

    let captured;
    client.on('conflict', (e) => { captured = e; e.cancelWrite(); });
    await client.write('/n.md', 'l').catch(() => {});
    expect(captured).toBeInstanceOf(ConflictResolver);
  });
});

// ── listener-driven: cancelWrite ─────────────────────────────────────────────

describe("PodClient — 'conflict' event with cancelWrite()", () => {
  it('throws ConflictError when the listener cancels', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md');
    ps.write.mockRejectedValueOnce(podErr('CONFLICT'));
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('r'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 1,
    });

    client.on('conflict', (e) => { e.cancelWrite(); });
    const err = await client.write('/n.md', 'l').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    // No retry.
    expect(ps.write).toHaveBeenCalledTimes(1);
  });
});

// ── listener does nothing → policy fallthrough ───────────────────────────────

describe('PodClient — listener that does nothing falls through to policy', () => {
  it('listener is silent → default "reject" policy throws after timeout', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md');
    ps.write.mockRejectedValueOnce(podErr('CONFLICT'));
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('r'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 1,
    });

    client.on('conflict', () => { /* deliberate no-op */ });

    const err = await client.write('/n.md', 'l').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(ps.write).toHaveBeenCalledTimes(1);
  });

  it('listener is silent + policy "lww" → retries with force after timeout', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    seedEtag(client, '/n.md');
    ps.write
      .mockRejectedValueOnce(podErr('CONFLICT'))
      .mockResolvedValueOnce({ uri: '/n.md', contentType: 'text/plain', lastModified: 'R2', etag: '"forced"', size: 1 });
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('r'),
      contentType: 'text/plain',
      lastModified: 'R1',
      etag: '"remote"',
      size: 1,
    });

    client.on('conflict', () => { /* deliberate no-op */ });

    const res = await client.write('/n.md', 'l', { conflictPolicy: 'lww' });
    expect(res.etag).toBe('"forced"');
    expect(ps.write).toHaveBeenCalledTimes(2);
  });
});

// ── append retry contract (Q-A.4) ────────────────────────────────────────────

describe('PodClient.append — retry contract (Q-A.4)', () => {
  it('default retries = 3 (4 total attempts), exhausts to CONFLICT_RETRY_EXHAUSTED', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('a\n'),
      contentType: 'text/plain',
      lastModified: 'x',
      etag: '"E1"',
      size: 2,
    });
    ps.write.mockRejectedValue(podErr('CONFLICT'));

    const err = await client.append('/log', 'b').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT_RETRY_EXHAUSTED');
    // retries default = 3 → up to 4 total attempts.
    expect(ps.write).toHaveBeenCalledTimes(4);
  });

  it('retries: 0 errors immediately on first conflict (no retry)', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('a\n'),
      contentType: 'text/plain',
      lastModified: 'x',
      etag: '"E1"',
      size: 2,
    });
    ps.write.mockRejectedValue(podErr('CONFLICT'));

    const err = await client.append('/log', 'b', { retries: 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.code).toBe('CONFLICT_RETRY_EXHAUSTED');
    // retries=0 → exactly 1 attempt.
    expect(ps.write).toHaveBeenCalledTimes(1);
  });

  it("does not surface the public 'conflict' event during append's internal retries", async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    ps.read.mockResolvedValue({
      content: new TextEncoder().encode('a\n'),
      contentType: 'text/plain',
      lastModified: 'x',
      etag: '"E1"',
      size: 2,
    });
    ps.write
      .mockRejectedValueOnce(podErr('CONFLICT'))
      .mockResolvedValueOnce({ uri: '/log', contentType: 'text/plain', lastModified: 'y', etag: '"E2"', size: 5 });

    const events = [];
    client.on('conflict', (e) => { events.push(e); });

    await client.append('/log', 'b');
    expect(events).toEqual([]); // suppressed
    expect(ps.write).toHaveBeenCalledTimes(2);
  });
});

// ── ConflictResolver unit ────────────────────────────────────────────────────

describe('ConflictResolver', () => {
  it('resolveWith resolves _wait with kind=RESOLVE + content', async () => {
    const r = new ConflictResolver({ uri: '/x', localContent: 'l' });
    queueMicrotask(() => r.resolveWith('merged'));
    const decision = await r._wait(50);
    expect(decision).toEqual({ kind: ConflictResolver.RESOLVE, content: 'merged' });
  });

  it('cancelWrite resolves _wait with kind=CANCEL', async () => {
    const r = new ConflictResolver({ uri: '/x', localContent: 'l' });
    queueMicrotask(() => r.cancelWrite());
    const decision = await r._wait(50);
    expect(decision).toEqual({ kind: ConflictResolver.CANCEL });
  });

  it('times out to kind=TIMEOUT when neither method is called', async () => {
    const r = new ConflictResolver({ uri: '/x', localContent: 'l' });
    const decision = await r._wait(20);
    expect(decision).toEqual({ kind: ConflictResolver.TIMEOUT });
  });

  it('subsequent resolveWith/cancelWrite calls after settling are no-ops', async () => {
    const r = new ConflictResolver({ uri: '/x', localContent: 'l' });
    queueMicrotask(() => { r.resolveWith('first'); r.resolveWith('second'); r.cancelWrite(); });
    const decision = await r._wait(50);
    expect(decision).toEqual({ kind: ConflictResolver.RESOLVE, content: 'first' });
  });
});

// ── invalid policy ───────────────────────────────────────────────────────────

describe('PodClient.write — invalid conflictPolicy', () => {
  it('rejects unknown policies up-front', async () => {
    const ps = makePodSource();
    const client = makeClient(ps);
    await expect(client.write('/n.md', 'x', { conflictPolicy: 'bogus' })).rejects.toThrow(/invalid conflictPolicy/);
    expect(ps.write).not.toHaveBeenCalled();
  });
});
