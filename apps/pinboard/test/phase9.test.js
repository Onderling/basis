/**
 * Pinboard V1 — Phase 9 tests.
 *
 * PushPolicy (humanInTheLoop + per-day cap + quiet hours)
 * UsageMetrics (trivial counter)
 */

import { describe, it, expect, vi } from 'vitest';

import { PushPolicy }        from '../src/lib/PushPolicy.js';
import { UsageMetrics }      from '../src/lib/UsageMetrics.js';

describe('PushPolicy — humanInTheLoop + cap + quiet-hours', () => {
  it('rejects payloads that aren\'t humanInTheLoop', async () => {
    const send = vi.fn();
    const p = new PushPolicy({ send });
    const r = await p.tryPush({ recipient: 'r', payload: {} });
    expect(r).toEqual({ sent: false, reason: 'not-human-in-the-loop' });
    expect(send).not.toHaveBeenCalled();
  });

  it('sends when humanInTheLoop and under cap', async () => {
    const send = vi.fn().mockResolvedValue();
    const p = new PushPolicy({ send });
    const r = await p.tryPush({ recipient: 'r', payload: { humanInTheLoop: true, text: 'x' } });
    expect(r).toEqual({ sent: true });
    expect(send).toHaveBeenCalledOnce();
  });

  it('caps at maxPerDay (default 3)', async () => {
    const send = vi.fn().mockResolvedValue();
    const p = new PushPolicy({ send, maxPerDay: 2 });
    const payload = { humanInTheLoop: true, text: 'x' };
    expect(await p.tryPush({ recipient: 'r', payload })).toEqual({ sent: true });
    expect(await p.tryPush({ recipient: 'r', payload })).toEqual({ sent: true });
    expect(await p.tryPush({ recipient: 'r', payload })).toEqual({ sent: false, reason: 'over-cap' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('cap is per recipient', async () => {
    const send = vi.fn().mockResolvedValue();
    const p = new PushPolicy({ send, maxPerDay: 1 });
    const payload = { humanInTheLoop: true };
    expect(await p.tryPush({ recipient: 'A', payload })).toEqual({ sent: true });
    expect(await p.tryPush({ recipient: 'B', payload })).toEqual({ sent: true });
    expect(await p.tryPush({ recipient: 'A', payload })).toEqual({ sent: false, reason: 'over-cap' });
  });

  it('cap resets at UTC day boundary', async () => {
    const send = vi.fn().mockResolvedValue();
    let now = new Date('2026-05-06T10:00:00Z').getTime();
    const p = new PushPolicy({ send, maxPerDay: 1, now: () => now });
    const payload = { humanInTheLoop: true };
    expect(await p.tryPush({ recipient: 'r', payload })).toEqual({ sent: true });
    expect(await p.tryPush({ recipient: 'r', payload })).toEqual({ sent: false, reason: 'over-cap' });
    now = new Date('2026-05-07T01:00:00Z').getTime();
    expect(await p.tryPush({ recipient: 'r', payload })).toEqual({ sent: true });
  });

  it('quiet-hours window suppresses sends (window crosses midnight)', async () => {
    const send = vi.fn().mockResolvedValue();
    // At 23:00 local with quiet 22..7, sends are suppressed.
    let now = new Date('2026-05-06T23:00').getTime();
    const p = new PushPolicy({ send, quietHours: [22, 7], now: () => now });
    const r = await p.tryPush({ recipient: 'r', payload: { humanInTheLoop: true } });
    expect(r).toEqual({ sent: false, reason: 'quiet-hours' });
  });

  it('quiet-hours window passes at allowed hour', async () => {
    const send = vi.fn().mockResolvedValue();
    const now = new Date('2026-05-06T10:00').getTime();
    const p = new PushPolicy({ send, quietHours: [22, 7], now: () => now });
    expect(await p.tryPush({ recipient: 'r', payload: { humanInTheLoop: true } }))
      .toEqual({ sent: true });
  });

  it('countersSnapshot reflects per-recipient state', async () => {
    const send = vi.fn().mockResolvedValue();
    const p = new PushPolicy({ send });
    await p.tryPush({ recipient: 'r', payload: { humanInTheLoop: true } });
    const s = p.countersSnapshot();
    expect(s.r.count).toBe(1);
    expect(typeof s.r.day).toBe('string');
  });

  it('rejects construction without send', () => {
    expect(() => new PushPolicy({})).toThrow(/send/);
  });
});

// ── UsageMetrics ──────────────────────────────────────────────────────────

describe('UsageMetrics — trivial counter', () => {
  it('record + snapshot', () => {
    let now = 1000;
    const m = new UsageMetrics({ now: () => now });
    m.record('push.sent');
    m.record('push.sent');
    now = 2000;
    m.record('push.suppressed');
    const s = m.snapshot();
    expect(s['push.sent'].count).toBe(2);
    expect(s['push.sent'].lastAt).toBe(1000);
    expect(s['push.suppressed'].count).toBe(1);
    expect(s['push.suppressed'].lastAt).toBe(2000);
  });

  it('reset(name) drops one counter', () => {
    const m = new UsageMetrics();
    m.record('a'); m.record('b');
    m.reset('a');
    expect(m.snapshot()).not.toHaveProperty('a');
    expect(m.snapshot()).toHaveProperty('b');
  });

  it('reset() drops all counters', () => {
    const m = new UsageMetrics();
    m.record('a'); m.record('b');
    m.reset();
    expect(m.snapshot()).toEqual({});
  });

  it('rejects empty / non-string names', () => {
    const m = new UsageMetrics();
    expect(() => m.record('')).toThrow();
    expect(() => m.record(undefined)).toThrow();
  });
});
