/**
 * PushPolicy substrate test suite. Mirrors the Pinboard phase-9 cases
 * that motivated the lift; pinned here so the substrate's invariants
 * survive even if Pinboard's copy moves again.
 */

import { describe, it, expect, vi } from 'vitest';

import { PushPolicy } from '../src/PushPolicy.js';

describe('PushPolicy', () => {
  it('drops machine-only payloads (humanInTheLoop falsy)', async () => {
    const send = vi.fn();
    const p = new PushPolicy({ send });
    const r = await p.tryPush({ recipient: 'a', payload: { text: 'x' } });
    expect(r).toEqual({ sent: false, reason: 'not-human-in-the-loop' });
    expect(send).not.toHaveBeenCalled();
  });

  it('forwards humanInTheLoop payloads + increments counter', async () => {
    const send = vi.fn(async () => {});
    const p = new PushPolicy({ send });
    const r = await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    expect(r).toEqual({ sent: true });
    expect(send).toHaveBeenCalledOnce();
    expect(p.countersSnapshot()['a'].count).toBe(1);
  });

  it('caps at maxPerDay per recipient', async () => {
    const send = vi.fn(async () => {});
    const p = new PushPolicy({ send, maxPerDay: 2 });
    await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    const blocked = await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    expect(blocked).toEqual({ sent: false, reason: 'over-cap' });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('counter is per-recipient', async () => {
    const send = vi.fn(async () => {});
    const p = new PushPolicy({ send, maxPerDay: 1 });
    await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    const r = await p.tryPush({ recipient: 'b', payload: { humanInTheLoop: true } });
    expect(r.sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('counter resets on day rollover', async () => {
    let now = Date.UTC(2026, 4, 7, 12, 0, 0);
    const send = vi.fn(async () => {});
    const p = new PushPolicy({ send, maxPerDay: 1, now: () => now });
    await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    expect((await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } })).sent).toBe(false);
    now += 24 * 3600 * 1000;
    expect((await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } })).sent).toBe(true);
  });

  it('quiet-hours blocks sends inside a wrap-around window', async () => {
    const send = vi.fn(async () => {});
    let now = new Date(2026, 4, 7, 23, 30, 0).getTime(); // 23:30 local
    const p = new PushPolicy({ send, quietHours: [22, 7], now: () => now });
    const r = await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    expect(r).toEqual({ sent: false, reason: 'quiet-hours' });
  });

  it('quiet-hours allows sends outside the window', async () => {
    const send = vi.fn(async () => {});
    const now = new Date(2026, 4, 7, 12, 0, 0).getTime(); // mid-day
    const p = new PushPolicy({ send, quietHours: [22, 7], now: () => now });
    const r = await p.tryPush({ recipient: 'a', payload: { humanInTheLoop: true } });
    expect(r.sent).toBe(true);
  });

  it('throws without a send function', () => {
    expect(() => new PushPolicy({})).toThrow(/send/);
  });
});
