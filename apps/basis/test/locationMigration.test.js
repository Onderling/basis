/**
 * location fold-in (audit §4) — one-time seed of the person-level `location` property from
 * the bespoke pinboard `profile.location {cell,label,source}` field (locationMigration.js).
 * Pins: marker idempotence, coarse-label seeding (never raw coords), the skip-but-mark case
 * (no bespoke location), and that the marker is set once the seed persists.
 */
import { describe, it, expect } from 'vitest';
import {
  migrateLocation, LOCATION_MIGRATION_KEY,
} from '../src/core/locationMigration.js';

/** A callSkill stub over a tiny in-memory profile + a pinboard location signal; records calls. */
function makeHost({ location = null, markerDone = false } = {}) {
  const calls = [];
  const props = {};
  if (markerDone) props[LOCATION_MIGRATION_KEY] = { mode: 'own', value: 'done' };
  const callSkill = async (origin, opId, args) => {
    calls.push({ origin, opId, args });
    if (origin === 'agents' && opId === 'getProfileProperties') return { ok: true, properties: { ...props } };
    if (origin === 'agents' && opId === 'setProfileProperty') { props[args.key] = { mode: 'own', value: args.value }; return { ok: true }; }
    if (origin === 'pinboard' && opId === 'getMyLocation') return { location };
    return { ok: false, reason: `unstubbed ${origin}.${opId}` };
  };
  return { callSkill, calls, props };
}

const setPropCalls = (calls) => calls.filter((c) => c.opId === 'setProfileProperty');

describe('location migration — seed from the bespoke pinboard location', () => {
  it('seeds the COARSE label token from {cell,label,source}, and marks done', async () => {
    const host = makeHost({ location: { cell: '52.3,4.9', label: 'Amsterdam', source: 'geocode' } });
    const res = await migrateLocation({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, seeded: 'Amsterdam' });
    expect(host.props.location).toMatchObject({ value: 'Amsterdam' });
    expect(host.props[LOCATION_MIGRATION_KEY]).toMatchObject({ value: 'done' });
  });

  it('never seeds raw coords — falls back to the cell token when no label', async () => {
    const host = makeHost({ location: { cell: '52.3,4.9', source: 'gps' } });
    const res = await migrateLocation({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, seeded: '52.3,4.9' });
  });

  it('skips seeding when there is no bespoke location, but still marks done', async () => {
    const host = makeHost({ location: null });
    const res = await migrateLocation({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, skipped: true });
    expect(host.props.location).toBeUndefined();               // nothing seeded
    expect(host.props[LOCATION_MIGRATION_KEY]).toMatchObject({ value: 'done' });   // still one-time
  });

  it('is idempotent — a set marker makes it a no-op (no writes)', async () => {
    const host = makeHost({ location: { label: 'Amsterdam' }, markerDone: true });
    const res = await migrateLocation({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, already: true });
    expect(setPropCalls(host.calls)).toHaveLength(0);
  });

  it('running twice writes only once (second run sees the marker)', async () => {
    const host = makeHost({ location: { label: 'Amsterdam' } });
    await migrateLocation({ callSkill: host.callSkill });
    const before = setPropCalls(host.calls).length;
    const res2 = await migrateLocation({ callSkill: host.callSkill });
    expect(res2).toMatchObject({ already: true });
    expect(setPropCalls(host.calls).length).toBe(before);      // no further writes
  });
});
