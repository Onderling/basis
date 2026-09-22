/**
 * `member-props` — what a member says about themselves, emitted on the membership lane (2026-09-21; the note
 * `NOTE-member-props-on-the-membership-lane.md`, Fable's review). One statement PER CIRCLE, carrying only the fields
 * that differ from that circle's roster row (the diff gate: an unchanged save appends nothing), tolerant of a circle
 * whose append fails (the loop goes on; the next save retries it).
 */
import { describe, it, expect, vi } from 'vitest';
import { emitMemberProps } from '../src/circleMembershipWriters.js';

const ME = 'me-webid';
const rosterOf = (rows) => async (circleId) => rows[circleId] ?? [];

describe('emitMemberProps', () => {
  it('one statement per circle, only the fields that differ from that circle\'s row; nothing where nothing changed', async () => {
    const emitted = [];
    const emitSpine = vi.fn(async (stmt) => { emitted.push(stmt); return { hash: 'h' }; });
    // `said` = what the LANE holds (the fold's props); the other display fields are the local cache, which already
    // shows the new name before any statement exists — the gate must not read those
    const rows = {
      'c1': [{ webid: ME, handle: 'anna', displayName: 'Anna', said: { handle: 'old', displayName: 'Old Name' } }],
      'c2': [{ webid: ME, handle: 'anna', displayName: 'Anna', said: { handle: 'anna', displayName: 'Old Name' } }],   // the lane has the handle already
      'pair-x': [{ webid: ME, handle: 'anna', displayName: 'Anna', said: { handle: 'anna', displayName: 'Anna' } }],   // nothing to say here
    };
    const r = await emitMemberProps({ emitSpine, myRowIn: rosterOf(rows) }, { from: ME, circleIds: ['c1', 'c2', 'pair-x'], props: { handle: 'anna', displayName: 'Anna' } });
    expect(emitted.map((s) => [s.circleId, s.kind, s.subject, s.actor, s.payload])).toEqual([
      ['c1', 'member-props', ME, ME, { handle: 'anna', displayName: 'Anna' }],
      ['c2', 'member-props', ME, ME, { displayName: 'Anna' }],
    ]);
    expect(r).toEqual({ ok: true, emitted: ['c1', 'c2'], unchanged: ['pair-x'], failed: [] });
  });
  it('a circle whose append fails does not stop the others, and is named', async () => {
    const emitSpine = vi.fn(async (stmt) => { if (stmt.circleId === 'c1') throw new Error('rail down'); return { hash: 'h' }; });
    const r = await emitMemberProps({ emitSpine, myRowIn: rosterOf({}) }, { from: ME, circleIds: ['c1', 'c2'], props: { displayName: 'Anna' } });
    expect(r).toEqual({ ok: true, emitted: ['c2'], unchanged: [], failed: ['c1'] });
  });
  it('only the allowed fields ever ride; an empty or foreign set emits nothing', async () => {
    const emitSpine = vi.fn(async () => ({ hash: 'h' }));
    const r = await emitMemberProps({ emitSpine, myRowIn: rosterOf({}) }, { from: ME, circleIds: ['c1'], props: { role: 'admin', circleAddress: 'x' } });
    expect(emitSpine).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, emitted: [], unchanged: ['c1'], failed: [] });
    expect(await emitMemberProps({ emitSpine: null }, { from: ME, circleIds: ['c1'], props: { displayName: 'A' } })).toEqual({ error: 'no-membership-rail' });
  });
});

describe('emitMemberProps — the persona properties (step two, 2026-09-22)', () => {
  it('the release rides as ONE map for the circle named; the gate compares the whole map against what the lane holds; `{}` is a clear', async () => {
    const emitted = [];
    const emitSpine = vi.fn(async (stmt) => { emitted.push(stmt); return { hash: 'h' }; });
    const rows = {
      'c1':     [{ webid: ME, said: { personaProperties: { region: 'noord' } } }],
      'c2':     [{ webid: ME, said: { personaProperties: { region: 'zuid', profilePicture: { ref: 'media:1' } } } }],
      'pair-x': [{ webid: ME, said: {} }],
    };
    const props = { personaProperties: { region: 'zuid', profilePicture: { ref: 'media:1' } } };
    const r = await emitMemberProps({ emitSpine, myRowIn: rosterOf(rows) }, { from: ME, circleIds: ['c1', 'c2'], props });
    expect(emitted.map((s) => [s.circleId, s.payload])).toEqual([['c1', props]]);   // c2 already says exactly this
    expect(r).toEqual({ ok: true, emitted: ['c1'], unchanged: ['c2'], failed: [] });
    emitted.length = 0;
    const cleared = await emitMemberProps({ emitSpine, myRowIn: rosterOf(rows) }, { from: ME, circleIds: ['c1', 'pair-x'], props: { personaProperties: {} } });
    expect(emitted.map((s) => [s.circleId, s.payload])).toEqual([['c1', { personaProperties: {} }]]);   // a clear is a change where something was said
    expect(cleared.unchanged, 'the lane never said anything here: an empty release changes nothing').toEqual(['pair-x']);
    expect((await emitMemberProps({ emitSpine, myRowIn: rosterOf(rows) }, { from: ME, circleIds: ['c1'], props: { personaProperties: 'noord' } })).emitted)
      .toEqual([]);   // not a map: nothing to say (the circle counts as unchanged, as for an empty set)
  });
});
