/**
 * A CIRCLE PUT AWAY (opbergen, Frits 2026-09-24) — a person-level mark on the circle's registry record: the circle
 * is out of sight on every device of the person, and it wakes nobody. Kept on the record the restore reads, so a
 * restored device puts the same circles away. `{ putAway, at }`: the newer change wins between devices.
 */
import { describe, it, expect } from 'vitest';
import { setCircleMembership, normaliseCircleMembership, isCircleMembershipRecord } from '../src/circleMembership.js';

const base = (m) => ({ circleMemberships: { mode: 'own', value: m } });

describe('the sight facet on a circle membership record', () => {
  it('is recorded and survives the normaliser (an unknown facet would be dropped in silence)', () => {
    const p = setCircleMembership(base({ c1: { address: 'a1', handle: 'h' } }), 'c1', { sight: { putAway: true, at: 5 } });
    expect(p.circleMemberships.value.c1).toMatchObject({ address: 'a1', handle: 'h', sight: { putAway: true, at: 5 } });
  });
  it('a later patch that does not mention it keeps it', () => {
    let p = setCircleMembership(base({ c1: { address: 'a1' } }), 'c1', { sight: { putAway: true, at: 5 } });
    p = setCircleMembership(p, 'c1', { handle: 'h2' });
    expect(p.circleMemberships.value.c1.sight).toEqual({ putAway: true, at: 5 });
  });
  it('a malformed sight is refused', () => {
    expect(isCircleMembershipRecord({ address: 'a', sight: { putAway: 'yes', at: 1 } })).toBe(false);
    expect(isCircleMembershipRecord({ address: 'a', sight: { putAway: true } })).toBe(false);
    expect(normaliseCircleMembership({ address: 'a', sight: { putAway: false, at: 2 } }).sight).toEqual({ putAway: false, at: 2 });
  });
});
