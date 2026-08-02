/**
 * The relay holds a message for as long as the app does.
 *
 * Found 2026-07-31 while answering a much smaller question ("does a real relay hold, or accept-and-drop?").
 * It holds — but the default TTL was **five minutes**, while `createSecureAgent`'s own hold queue has always
 * used **24 hours**. Two layers of the same system disagreed by 288× about how long an undelivered message
 * survives, and nothing said so: `ForwardQueue` reports `'delivered'`/`'queued'`, and the caller does not
 * read it, so a message evicted by the timer looked exactly like one that arrived.
 *
 * These tests pin the agreement, not the number. If someone changes either side, this fails and they have
 * to change both — or decide, on purpose, that the two layers should differ.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ForwardQueue } from '../src/ForwardQueue.js';

/** Read a numeric constant out of a source file without importing the whole module. */
const constantIn = (path, re, what) => {
  const src = readFileSync(new URL(path, import.meta.url), 'utf8');
  const m = src.match(re);
  if (!m) throw new Error(`${what} not found in ${path} — was it renamed? This guard is only as good as its anchor.`);
  // eslint-disable-next-line no-new-func -- arithmetic literals only, from our own source
  return Function(`"use strict"; return (${m[1].replace(/\/\/.*$/, '').trim()});`)();
};

const RELAY_TTL = [/DEFAULT_QUEUE_TTL\s*=\s*([^;\n]+)/, 'DEFAULT_QUEUE_TTL'];
const APP_TTL = [/opts\.holdTtlMs\s*:\s*([^;\n]+)/, "createSecureAgent's holdTtlMs default"];

/** How many entries is the queue holding for this address? (ForwardQueue exposes no size().) */
const queued = (q, to) => {
  let n = 0;
  q.drain(to, { readyState: 1, send: () => { n += 1; } });
  return n;
};

const DAY = 24 * 60 * 60_000;

describe('relay queue retention', () => {
  it('defaults to 24 h, not the old 5 minutes', () => {
    expect(constantIn('../src/server.js', ...RELAY_TTL)).toBe(DAY);
  });

  it('AGREES with the app-side hold queue — the whole point of the number', () => {
    const appTtl = constantIn('../../secure-agent/src/createSecureAgent.js', ...APP_TTL);
    expect(appTtl).toBe(constantIn('../src/server.js', ...RELAY_TTL));
  });
});

describe('what actually bounds memory is the CAP, not the TTL', () => {
  // the argument for raising the TTL rests on this: per-address depth is capped whatever the TTL is.
  it('never holds more than queueCapTotal for one address, however long the TTL', () => {
    const q = new ForwardQueue({ ttlMs: DAY, queueCap: 5, queueCapTotal: 8, topicAware: true });
    for (let i = 0; i < 50; i++) q.deliverOrEnqueue('bob', { n: i }, { socket: null, topic: `t${i % 3}` });
    expect(queued(q, 'bob')).toBeLessThanOrEqual(8);
  });

  it('still evicts on TTL — a longer hold is not an unbounded one', () => {
    // ForwardQueue reads Date.now() directly (no injectable clock), so the system time is the only seam.
    vi.useFakeTimers();
    try {
      const q = new ForwardQueue({ ttlMs: 1000, topicAware: true });
      q.deliverOrEnqueue('bob', { n: 1 }, { socket: null, topic: 't' });
      vi.advanceTimersByTime(1001);
      q.evictExpired();
      expect(queued(q, 'bob')).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT evict one that is still inside the window', () => {
    vi.useFakeTimers();
    try {
      const q = new ForwardQueue({ ttlMs: DAY, topicAware: true });
      q.deliverOrEnqueue('bob', { n: 1 }, { socket: null, topic: 't' });
      vi.advanceTimersByTime(6 * 60 * 60_000);   // six hours — dead under the OLD five-minute default
      q.evictExpired();
      expect(queued(q, 'bob')).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the honesty gap this did NOT close', () => {
  it('deliverOrEnqueue still distinguishes delivered from queued — the caller just has to read it', () => {
    // Recorded, not fixed: server.js does not read this return, so an evicted message and a delivered one
    // are indistinguishable to the sender. That is R2's work (the UI must not lie), not the TTL's.
    const q = new ForwardQueue({ ttlMs: DAY, topicAware: true });
    const sent = [];
    const socket = { send: (m) => sent.push(m), readyState: 1 };
    expect(q.deliverOrEnqueue('online', { a: 1 }, { socket, topic: 't' })).toBe('delivered');
    expect(q.deliverOrEnqueue('offline', { a: 1 }, { socket: null, topic: 't' })).toBe('queued');
  });
});
