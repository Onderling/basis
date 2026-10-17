/**
 * PseudoPod — standalone mode.
 *
 * Covers:
 *   - Constructor argument validation.
 *   - URI scheme enforcement (only pseudo-pod://).
 *   - read/write/delete round-trip.
 *   - write to non-local URI rejected.
 *   - list returns container contents.
 *   - subscribe fires on writes under a URI.
 *   - fetchResourceSkill is registered/invokable shape.
 */

import { describe, it, expect } from 'vitest';
import { createPseudoPod, createMemoryBackend, PSEUDO_POD_MODES } from '../index.js';

describe('PSEUDO_POD_MODES — exported store-mode vocabulary', () => {
  it('is the three store-backing modes, frozen (single source for the data-policy mapping)', () => {
    expect(PSEUDO_POD_MODES).toEqual(['standalone', 'replication-ring', 'cache']);
    expect(Object.isFrozen(PSEUDO_POD_MODES)).toBe(true);
  });

  it('createPseudoPod accepts exactly the exported modes', () => {
    expect(() => createPseudoPod({ backend: createMemoryBackend(), mode: 'bogus', deviceId: 'd' }))
      .toThrow(/standalone/);
  });
});

function mkPod() {
  return createPseudoPod({
    backend:  createMemoryBackend(),
    mode:     'standalone',
    deviceId: 'laptop-anne',
  });
}

describe('PseudoPod — constructor validation', () => {
  it('throws on missing backend', () => {
    expect(() => createPseudoPod({ mode: 'standalone', deviceId: 'x' }))
      .toThrow(/backend/);
  });

  it('throws on bad mode', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode:    'wrong',
      deviceId: 'x',
    })).toThrow(/mode/);
  });

  it('throws on missing deviceId', () => {
    expect(() => createPseudoPod({
      backend: createMemoryBackend(),
      mode:    'standalone',
    })).toThrow(/deviceId/);
  });

  it('replication-ring requires transport + getPeers', () => {
    expect(() => createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 'x',
    })).toThrow(/transport/);
    expect(() => createPseudoPod({
      backend:  createMemoryBackend(),
      mode:     'replication-ring',
      deviceId: 'x',
      transport: { publishEnvelope: async () => {} },
    })).toThrow(/getPeers/);
  });
});

describe('PseudoPod — URI scheme', () => {
  it('write rejects non-pseudo-pod URIs', async () => {
    const pod = mkPod();
    await expect(pod.write('https://anne.pod/x', { a: 1 }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_SCHEME' });
  });

  it('write rejects URIs for another device', async () => {
    const pod = mkPod();
    await expect(pod.write('pseudo-pod://other/x', { a: 1 }))
      .rejects.toMatchObject({ code: 'NOT_LOCAL' });
  });

  it('read of an unknown non-pseudo-pod URI returns null (cache miss)', async () => {
    const pod = mkPod();
    expect(await pod.read('https://anne.pod/x')).toBe(null);
  });

  it('writeFromPeer accepts any URI scheme (cache from peer)', async () => {
    const pod = mkPod();
    await pod.writeFromPeer('https://anne.pod/x', { value: 1 }, '"e"');
    expect((await pod.read('https://anne.pod/x'))?.bytes).toEqual({ value: 1 });
  });
});

describe('PseudoPod.standalone — round-trip', () => {
  it('writes and reads back', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/tasks/abc';
    const { etag, _v } = await pod.write(uri, { text: 'paint' });
    expect(typeof etag).toBe('string');
    expect(_v).toBe(1);
    const rec = await pod.read(uri);
    expect(rec).toEqual({ uri, bytes: { text: 'paint' }, etag, _v: 1 });
  });

  it('a write\'s etag is an IF-MATCH: compared, never assigned — a stale one is a CONFLICT', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/notes/1';
    const first = await pod.write(uri, 'hi');
    const second = await pod.write(uri, 'hi again', first.etag);
    expect(second.etag, 'a fresh etag every write').not.toBe(first.etag);
    await expect(pod.write(uri, 'from a stale read', first.etag)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await pod.read(uri)).bytes, 'the stale write did not land').toBe('hi again');
    await expect(pod.write('pseudo-pod://laptop-anne/notes/2', 'x', '"never-read"'), 'an if-match on a missing resource').rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('returns null for missing reads', async () => {
    const pod = mkPod();
    expect(await pod.read('pseudo-pod://laptop-anne/nope')).toBe(null);
  });

  it('delete removes a resource', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/x';
    await pod.write(uri, 1);
    await pod.delete(uri);
    expect(await pod.read(uri)).toBe(null);
  });

  it('list returns container contents', async () => {
    const pod = mkPod();
    await pod.write('pseudo-pod://laptop-anne/tasks/a', 1);
    await pod.write('pseudo-pod://laptop-anne/tasks/b', 1);
    await pod.write('pseudo-pod://laptop-anne/notes/c', 1);
    expect(await pod.list('pseudo-pod://laptop-anne/tasks/')).toEqual([
      'pseudo-pod://laptop-anne/tasks/a',
      'pseudo-pod://laptop-anne/tasks/b',
    ]);
  });

  it('list tolerates URIs without trailing slash', async () => {
    const pod = mkPod();
    await pod.write('pseudo-pod://laptop-anne/tasks/a', 1);
    expect(await pod.list('pseudo-pod://laptop-anne/tasks')).toEqual([
      'pseudo-pod://laptop-anne/tasks/a',
    ]);
  });
});

describe('PseudoPod.standalone — subscribe', () => {
  it('fires on writes under the subscribed URI prefix', async () => {
    const pod = mkPod();
    const events = [];
    pod.subscribe('pseudo-pod://laptop-anne/tasks/', (e) => events.push(e));

    await pod.write('pseudo-pod://laptop-anne/tasks/a', 1);
    await pod.write('pseudo-pod://laptop-anne/notes/x', 1);
    await pod.write('pseudo-pod://laptop-anne/tasks/b', 1);

    expect(events.map(e => e.key)).toEqual([
      'pseudo-pod://laptop-anne/tasks/a',
      'pseudo-pod://laptop-anne/tasks/b',
    ]);
  });
});

describe('PseudoPod — fetchResourceSkill', () => {
  it('returns a skill definition shape', () => {
    const pod = mkPod();
    const skill = pod.fetchResourceSkill();
    expect(skill).toBeTruthy();
    expect(typeof skill.handler).toBe('function');
    expect(skill.id).toBe('fetch-resource');
  });

  it('reads through to the pseudo-pod', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/x';
    await pod.write(uri, { value: 42 });

    const skill = pod.fetchResourceSkill();
    const parts = await skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
    });
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe('DataPart');
    expect(parts[0].data.bytes).toEqual({ value: 42 });
    expect(typeof parts[0].data.etag).toBe('string');
  });

  it('NOT_FOUND error for missing resource via skill', async () => {
    const pod = mkPod();
    const skill = pod.fetchResourceSkill();
    await expect(skill.handler({
      parts: [{ type: 'DataPart', data: { uri: 'pseudo-pod://laptop-anne/missing' } }],
    })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  // Phase 52.2.x (Q#2 2026-05-14) — peer-fetch gates pass through.
  it('groupCheck opt flows through to the underlying skill', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/secret';
    await pod.write(uri, 'private-bytes');

    const members = new Set(['pubkey:bob']);
    const skill = pod.fetchResourceSkill({
      groupCheck: (_uri, ctx) => members.has(ctx.from),
    });

    // Member: served.
    const ok = await skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
      from:  'pubkey:bob',
    });
    expect(ok[0].data.bytes).toBe('private-bytes');

    // Ex-member (kicked out of the set): FORBIDDEN.
    members.delete('pubkey:bob');
    await expect(skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
      from:  'pubkey:bob',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Non-member: FORBIDDEN.
    await expect(skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
      from:  'pubkey:carol',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('capCheck opt flows through (cap-token bypass for non-members)', async () => {
    const pod = mkPod();
    const uri = 'pseudo-pod://laptop-anne/shareable';
    await pod.write(uri, 'shared-bytes');

    const skill = pod.fetchResourceSkill({
      groupCheck: () => false,        // no one is a member
      capCheck:   (_uri, ctx) => ctx.capToken === 'valid',
    });

    // Non-member with valid cap-token: served.
    const ok = await skill.handler({
      parts: [{ type: 'DataPart', data: { uri, capToken: 'valid' } }],
      from:  'pubkey:external',
    });
    expect(ok[0].data.bytes).toBe('shared-bytes');

    // Non-member without cap-token: FORBIDDEN.
    await expect(skill.handler({
      parts: [{ type: 'DataPart', data: { uri } }],
      from:  'pubkey:external',
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('PseudoPod — mode introspection', () => {
  it('reports the current global mode for any URI in V0', () => {
    const pod = mkPod();
    expect(pod.mode('pseudo-pod://laptop-anne/x')).toBe('standalone');
    expect(pod.currentMode).toBe('standalone');
  });

  it('flush is a no-op stub in V0', async () => {
    const pod = mkPod();
    await expect(pod.flush('pseudo-pod://laptop-anne/x')).resolves.toBeUndefined();
  });
});

describe('the create race', () => {
  it('an if-match of null ("I read nothing") lands only while there is still nothing', async () => {
    const pod = createPseudoPod({ backend: createMemoryBackend(), mode: 'standalone', deviceId: 'laptop-anne' });
    const uri = 'pseudo-pod://laptop-anne/notes/new';
    await pod.write(uri, 'first creator', null);
    await expect(pod.write(uri, 'second creator', null)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await pod.read(uri)).bytes).toBe('first creator');
  });
});
