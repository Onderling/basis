/**
 * When the relay gives up on a queued message, the sender is told.
 *
 * The gap: `ForwardQueue.deliverOrEnqueue` has always returned `'delivered'`/`'queued'` and `server.js`
 * has never read it, so a message the relay eventually threw away was indistinguishable, from the
 * sender's side, from one that arrived. Raising the TTL to 24 h narrowed the window; it did not close the
 * honesty gap.
 *
 * ── The shape of the fix matters more than the fix ───────────────────────────────────────────────────
 * The obvious reading of "tell the sender" is to pass `'queued'` back. **That would be a presence
 * oracle**: send one message to any address, read the answer, learn whether that person is connected —
 * on demand, invisibly, to anyone. `deliveryState.js` already refuses this class of thing (it dropped
 * `reached-device` because it let you spot a peer who had turned receipts off).
 *
 * A give-up is different in kind: coarse (after the TTL, not "right now"), unsolicited rather than
 * probeable, and it carries something the sender actually needs. So that is what is reported, and the
 * test below pins the distinction — `queued` must NOT be observable.
 */

import { describe, it, expect, vi } from 'vitest';
import { ForwardQueue } from '../src/ForwardQueue.js';

const env = (id, from = 'alice') => ({ _v: 1, _p: 'OW', _id: id, _from: from, _to: 'bob', payload: {} });
const openSocket = () => { const sent = []; return { readyState: 1, send: (m) => sent.push(JSON.parse(m)), sent }; };

describe('ForwardQueue announces every give-up', () => {
  it('reports a TTL eviction', () => {
    vi.useFakeTimers();
    try {
      const seen = [];
      const q = new ForwardQueue({ ttlMs: 1000, topicAware: true, onGiveUp: (i) => seen.push(i) });
      q.deliverOrEnqueue('bob', env('m1'), { socket: null, topic: 't' });
      vi.advanceTimersByTime(1001);
      q.evictExpired();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ to: 'bob', reason: 'expired' });
      expect(seen[0].envelope._id).toBe('m1');
    } finally { vi.useRealTimers(); }
  });

  it('reports a per-bucket cap eviction, naming the message that was dropped', () => {
    const seen = [];
    const q = new ForwardQueue({ ttlMs: null, topicAware: true, queueCap: 2, onGiveUp: (i) => seen.push(i) });
    for (const id of ['m1', 'm2', 'm3']) q.deliverOrEnqueue('bob', env(id), { socket: null, topic: 't' });
    // the OLDEST goes, and the sender learns which
    expect(seen.map((s) => s.envelope._id)).toEqual(['m1']);
    expect(seen[0].reason).toBe('bucket-full');
  });

  it('reports the global per-address cap too', () => {
    const seen = [];
    const q = new ForwardQueue({ ttlMs: null, topicAware: true, queueCapTotal: 2, onGiveUp: (i) => seen.push(i) });
    for (const id of ['m1', 'm2', 'm3']) q.deliverOrEnqueue('bob', env(id), { socket: null, topic: `t${id}` });
    expect(seen.map((s) => s.reason)).toEqual(['address-full']);
  });

  it('does NOT report a successful drain — that removal means the opposite', () => {
    const seen = [];
    const q = new ForwardQueue({ ttlMs: null, topicAware: true, onGiveUp: (i) => seen.push(i) });
    q.deliverOrEnqueue('bob', env('m1'), { socket: null, topic: 't' });
    q.drain('bob', openSocket());
    expect(seen).toEqual([]);
  });

  it('does NOT report a direct delivery', () => {
    const seen = [];
    const q = new ForwardQueue({ ttlMs: null, topicAware: true, onGiveUp: (i) => seen.push(i) });
    q.deliverOrEnqueue('bob', env('m1'), { socket: openSocket(), topic: 't' });
    expect(seen).toEqual([]);
  });

  it('survives a consumer that throws — reporting must not break the queue it reports on', () => {
    const q = new ForwardQueue({
      ttlMs: null, topicAware: true, queueCap: 1,
      onGiveUp: () => { throw new Error('consumer exploded'); },
    });
    expect(() => {
      q.deliverOrEnqueue('bob', env('m1'), { socket: null, topic: 't' });
      q.deliverOrEnqueue('bob', env('m2'), { socket: null, topic: 't' });
    }).not.toThrow();
  });
});

describe('what the sender can and cannot learn', () => {
  it('the give-up notice names the message, not the recipient\'s whereabouts', () => {
    const seen = [];
    const q = new ForwardQueue({ ttlMs: null, topicAware: true, queueCap: 1, onGiveUp: (i) => seen.push(i) });
    q.deliverOrEnqueue('bob', env('m1'), { socket: null, topic: 't' });
    q.deliverOrEnqueue('bob', env('m2'), { socket: null, topic: 't' });
    // the wire frame server.js builds from this carries { type, id, reason } — and nothing else.
    expect(Object.keys(seen[0]).sort()).toEqual(['at', 'envelope', 'reason', 'to']);
    expect(seen[0].reason).not.toMatch(/offline|absent|away|present/i);
  });

  it('THE PRESENCE ORACLE IS NOT BUILT: queueing is silent', () => {
    // If this ever starts reporting, someone has turned "is this person online?" into a free query.
    const seen = [];
    const q = new ForwardQueue({ ttlMs: null, topicAware: true, onGiveUp: (i) => seen.push(i) });
    expect(q.deliverOrEnqueue('bob', env('m1'), { socket: null, topic: 't' })).toBe('queued');
    expect(seen).toEqual([]);   // the return value exists; nothing is pushed anywhere
  });
});
