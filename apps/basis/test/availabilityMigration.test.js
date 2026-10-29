/**
 * availability unification (decision) — one-time seed of the unified
 * `availability` property from the most-restrictive legacy signal
 * (availabilityMigration.js). Pins: marker idempotence, most-restrictive
 * seeding (holidayMode / per-skill availability → 'away'; else 'open'), and
 * that the marker is set once the seed persists.
 */
import { describe, it, expect } from 'vitest';
import {
  migrateAvailability, AVAILABILITY_MIGRATION_KEY,
} from '../src/core/availabilityMigration.js';

/** A callSkill stub over a tiny in-memory profile + roster signal; records calls. */
function makeHost({ holidayMode = false, rosterSkills = [], markerDone = false } = {}) {
  const calls = [];
  const props = {};
  if (markerDone) props[AVAILABILITY_MIGRATION_KEY] = { mode: 'own', value: 'done' };
  const callSkill = async (origin, opId, args) => {
    calls.push({ origin, opId, args });
    if (origin === 'agents' && opId === 'getProfileProperties') return { ok: true, properties: { ...props } };
    if (origin === 'agents' && opId === 'setProfileProperty') { props[args.key] = { mode: 'own', value: args.value }; return { ok: true }; }
    if (origin === 'pinboard' && opId === 'getHolidayMode') return { holidayMode };
    if (origin === 'pinboard' && (opId === 'listMyOfferings' || opId === 'listMySkills')) return { skills: rosterSkills };
    return { ok: false, reason: `unstubbed ${origin}.${opId}` };
  };
  return { callSkill, calls, props };
}

const setPropCalls = (calls) => calls.filter((c) => c.opId === 'setProfileProperty');

describe('availability migration — most-restrictive seed', () => {
  it('seeds "open" when there is no restrictive signal, and marks done', async () => {
    const host = makeHost({ holidayMode: false, rosterSkills: [{ categoryId: 'klussen' }] });
    const res = await migrateAvailability({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, seeded: 'open' });
    expect(host.props.availability).toMatchObject({ value: 'open' });
    expect(host.props[AVAILABILITY_MIGRATION_KEY]).toMatchObject({ value: 'done' });
  });

  it('seeds "away" from holidayMode:true (holiday IS the away rung)', async () => {
    const host = makeHost({ holidayMode: true });
    const res = await migrateAvailability({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, seeded: 'away' });
    expect(host.props.availability).toMatchObject({ value: 'away' });
  });

  it('seeds "away" from a legacy per-skill availability sub-field', async () => {
    const host = makeHost({ holidayMode: false, rosterSkills: [{ categoryId: 'klussen', availability: 'weekends' }] });
    const res = await migrateAvailability({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, seeded: 'away' });
  });

  it('is idempotent — a set marker makes it a no-op (no writes)', async () => {
    const host = makeHost({ holidayMode: true, markerDone: true });
    const res = await migrateAvailability({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, already: true });
    expect(setPropCalls(host.calls)).toHaveLength(0);
  });

  it('running twice writes only once (second run sees the marker)', async () => {
    const host = makeHost({ holidayMode: true });
    await migrateAvailability({ callSkill: host.callSkill });
    const before = setPropCalls(host.calls).length;
    const res2 = await migrateAvailability({ callSkill: host.callSkill });
    expect(res2).toMatchObject({ already: true });
    expect(setPropCalls(host.calls).length).toBe(before);   // no further writes
  });
});
