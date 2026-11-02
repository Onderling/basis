/**
 * A STATEMENT THIS DEVICE FANNED REACHES A MEMBER WHOSE ADDRESS LANDED LATER.
 *
 * A device fans a membership statement to the roster it holds at that moment. When that roster is short — a new point
 * that opened on a catch-up batch whose address rows were still being re-tried — the missing member never hears it from
 * the fan, and nothing tells them again. So this device remembers, for a while, which addresses each of its own
 * statements reached, and when the roster grows an address that was not among them, it tells those statements again
 * (the same signed statement, the same message id: every receiver dedupes).
 */
import { describe, it, expect } from 'vitest';
import { makeLateRecipientRetell } from '../src/v2/membershipLateRecipient.js';

const st = (hash) => ({ body: { hash, kind: 'role' } });

describe('a statement told again to a member whose address landed after the fan', () => {
  it('the roster grows an address the fan missed: the statement is told again', async () => {
    const told = [];
    let now = 1_000;
    const r = makeLateRecipientRetell({ retell: async (circleId, statement) => { told.push(`${circleId}:${statement.body.hash}`); }, now: () => now, windowMs: 60_000 });
    r.fanned('c1', st('s2'), ['cor-addr']);
    await r.rosterAddresses('c1', ['cor-addr']);
    expect(told, 'nothing new on the roster: nothing told again').toEqual([]);
    await r.rosterAddresses('c1', ['cor-addr', 'bea-addr']);
    expect(told).toEqual(['c1:s2']);
    await r.rosterAddresses('c1', ['cor-addr', 'bea-addr']);
    expect(told, 'told once per address that was missing').toEqual(['c1:s2']);
  });
  it('past the window it is not told again (catch-up covers an old statement); another circle is untouched', async () => {
    const told = [];
    let now = 1_000;
    const r = makeLateRecipientRetell({ retell: async (circleId, statement) => { told.push(`${circleId}:${statement.body.hash}`); }, now: () => now, windowMs: 60_000 });
    r.fanned('c1', st('old'), ['cor-addr']);
    now += 61_000;
    await r.rosterAddresses('c1', ['cor-addr', 'bea-addr']);
    await r.rosterAddresses('c2', ['x', 'y']);
    expect(told).toEqual([]);
  });
});
