/**
 * causalMerge (Objective L; unified Lamport clock #33) — clock + writer-id causal LWW comparator.
 * The pure decision behind inbound ingest: a causally-OLDER inbound (lower `clock`) never clobbers a newer local
 * edit; a causally-newer inbound wins; true concurrency (equal `clock`) resolves by a deterministic writer-id
 * tiebreak; a payload without a `clock` falls back to last-received-wins (a clockless edge, not the norm).
 */
import { describe, it, expect } from 'vitest';
import { causalWinner, causalRank } from '../src/causalMerge.js';

const at = (clock, updatedBy = 'w') => ({ id: 'X', type: 'task', clock, updatedBy });

describe('causalRank', () => {
  it('reads the integer Lamport clock; NaN when absent/non-numeric', () => {
    expect(causalRank({ clock: 1700 }).at).toBe(1700);
    expect(causalRank({ clock: 0 }).at).toBe(0);
    expect(Number.isNaN(causalRank({}).at)).toBe(true);
    expect(Number.isNaN(causalRank({ clock: 'not-a-number' }).at)).toBe(true);
    expect(causalRank(null).at).toBeNaN();
    expect(causalRank({ updatedBy: 'alice' }).by).toBe('alice');
  });

  it('does NOT read updatedAt (the wall clock is demoted to display, no longer ordering)', () => {
    expect(Number.isNaN(causalRank({ updatedAt: '2026-01-01T00:00:00.000Z' }).at)).toBe(true);
  });
});

describe('causalWinner', () => {
  it('no local → incoming (create)', () => {
    expect(causalWinner(null, at(1))).toBe('incoming');
  });

  it('newer inbound (higher clock) wins; OLDER inbound does NOT clobber', () => {
    const local = at(5);
    expect(causalWinner(local, at(6))).toBe('incoming'); // newer
    expect(causalWinner(local, at(4))).toBe('local');    // older → keep local
  });

  it('concurrent (equal clock) → deterministic writer-id tiebreak, symmetric', () => {
    const a = at(5, 'alice');
    const b = at(5, 'bob');
    // bob > alice, so bob always wins whichever side it is on
    expect(causalWinner(a, b)).toBe('incoming'); // local=alice, incoming=bob → bob
    expect(causalWinner(b, a)).toBe('local');    // local=bob,   incoming=alice → bob
  });

  it('fully identical (same clock + writer) → local (idempotent no-op)', () => {
    const x = at(5, 'alice');
    expect(causalWinner(x, { ...x })).toBe('local');
  });

  it('a clockless incoming → last-received-wins (incoming)', () => {
    expect(causalWinner(at(5), { id: 'X', type: 'task' })).toBe('incoming');
  });

  it('local clockless but incoming has one → incoming', () => {
    expect(causalWinner({ id: 'X', type: 'task' }, at(1))).toBe('incoming');
  });
});
