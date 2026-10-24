// Drivers #3 — the setProfileDriver / getProfileDrivers agent ops. Drivers are OPEN { kind, text,
// tags[] } values (not the coarse string setProfileProperty takes), so they get their own op that
// builds+validates via the injected `profiles` collaborator. Here we drive the cores with a fake
// collaborator backed by the REAL createDriver/driversFromProperties, so arg-handling + degrade +
// invalid-driver are all exercised.
import { describe, it, expect } from 'vitest';
import { createDriver, driversFromProperties } from '@onderling/agent-registry';
import { setProfileDriver, getProfileDrivers, removeProfileDriver } from '../src/cores.js';

// A minimal profiles collaborator mirroring realAgent's setDriver/getDrivers over an in-memory map.
function fakeStore() {
  const properties = { place: 'Groningen' };   // a non-driver property, to prove filtering
  return {
    registry: { list: async () => [] },
    profiles: {
      setDriver: async ({ key, kind, text, tags }) => { properties[key] = createDriver({ kind, text, tags }); return { ok: true }; },
      getDrivers: async () => driversFromProperties(properties),
      removeDriver: async ({ key }) => { if (!properties[key]?.kind) return { ok: false, reason: 'not-a-driver' }; delete properties[key]; return { ok: true }; },
    },
    _properties: properties,
  };
}

describe('setProfileDriver / getProfileDrivers (#3)', () => {
  it('sets a driver from an object arg and reads it back (filtering out non-drivers)', async () => {
    const store = fakeStore();
    const r = await setProfileDriver(store, { id: 'default', key: 'goals', kind: 'goal', text: 'learn to sail', tags: ['sailing', 'learning'] });
    expect(r).toEqual({ ok: true, id: 'default', key: 'goals' });
    expect(store._properties.goals).toEqual({ kind: 'goal', text: 'learn to sail', tags: ['sailing', 'learning'] });

    const got = await getProfileDrivers(store, { id: 'default' });
    expect(got.ok).toBe(true);
    expect(Object.keys(got.drivers)).toEqual(['goals']);   // place (coarse-enum) filtered out
    expect(got.drivers.goals.tags).toEqual(['sailing', 'learning']);
  });

  it('accepts kind offering end-to-end (offering fold-in): stored as offering, not downgraded', async () => {
    const store = fakeStore();
    const r = await setProfileDriver(store, { id: 'default', key: 'offering', kind: 'offering', text: 'ik repareer fietsen', tags: 'fiets, repareren' });
    expect(r).toEqual({ ok: true, id: 'default', key: 'offering' });
    expect(store._properties.offering.kind).toBe('offering');    // NOT the generic 'driver' fallback
    const got = await getProfileDrivers(store, { id: 'default' });
    expect(got.drivers.offering.tags).toEqual(['fiets', 'repareren']);
  });

  it('read-accepts the legacy kind skill, normalizing it to offering', async () => {
    const store = fakeStore();
    await setProfileDriver(store, { id: 'default', key: 'legacy', kind: 'skill', text: 'ik repareer fietsen', tags: 'fiets' });
    expect(store._properties.legacy.kind).toBe('offering');
  });

  it('accepts tags as a comma-separated string (wire/slash path)', async () => {
    const store = fakeStore();
    await setProfileDriver(store, { id: 'default', key: 'hobby', text: 'board games', tags: 'boardgames, social ,social' });
    expect(store._properties.hobby.tags).toEqual(['boardgames', 'social']);   // split, normalised, de-duped
    expect(store._properties.hobby.kind).toBe('driver');                       // default kind
  });

  it('an empty driver (no text, no tags) → ok:false invalid-driver (never persisted)', async () => {
    const store = fakeStore();
    const r = await setProfileDriver(store, { id: 'default', key: 'empty', tags: '' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid-driver');
    expect(store._properties.empty).toBeUndefined();
  });

  it('guards required args + degrades when the collaborator is unwired', async () => {
    const store = fakeStore();
    expect((await setProfileDriver(store, { key: 'x', text: 'y' })).reason).toBe('id-required');
    expect((await setProfileDriver(store, { id: 'default', text: 'y' })).reason).toBe('key-required');
    const unwired = { registry: { list: async () => [] }, profiles: {} };
    expect((await setProfileDriver(unwired, { id: 'd', key: 'k', text: 'y' })).reason).toBe('profiles-unavailable');
    expect((await getProfileDrivers(unwired, { id: 'd' })).reason).toBe('profiles-unavailable');
  });
});

describe('removeProfileDriver — a driver can be taken off again', () => {
  it('removes a driver; refuses a non-driver key and a missing id/key', async () => {
    const store = fakeStore();
    await setProfileDriver(store, { id: 'default', key: 'goals', kind: 'goal', text: 'zeilen leren', tags: ['zeilen'] });
    expect(await removeProfileDriver(store, { id: 'default', key: 'goals' })).toEqual({ ok: true, id: 'default', key: 'goals' });
    expect(Object.keys((await getProfileDrivers(store, { id: 'default' })).drivers)).toEqual([]);
    expect(await removeProfileDriver(store, { id: 'default', key: 'place' })).toMatchObject({ ok: false, reason: 'not-a-driver' });
    expect(await removeProfileDriver(store, { id: '', key: 'goals' })).toMatchObject({ ok: false, reason: 'id-required' });
  });
});
