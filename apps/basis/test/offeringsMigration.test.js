/**
 * Phase D — roster-skills → root-persona migration (offeringsMigration.js).
 * Pins: marker idempotence, per-item mapping (freeTags → text/tags, categoryId
 * preserved, label fallback), key-based dedupe, the NO-SILENT-RETRACTION rung
 * ('full' for the migrated circle only), and marker-on-empty.
 */
import { describe, it, expect } from 'vitest';
import {
  migrateRosterOfferings, offeringKeyFor, OFFERINGS_MIGRATION_KEY,
  LEGACY_SKILLS_MIGRATION_KEY,
} from '../src/core/offeringsMigration.js';

/** A callSkill stub over a tiny in-memory profile + roster; records every call. */
function makeHost({ rosterSkills = [], markerValue, legacyMarkerValue } = {}) {
  const calls = [];
  const props = {};
  if (markerValue != null) props[OFFERINGS_MIGRATION_KEY] = { mode: 'own', value: markerValue };
  if (legacyMarkerValue != null) props[LEGACY_SKILLS_MIGRATION_KEY] = { mode: 'own', value: legacyMarkerValue };
  const callSkill = async (origin, opId, args) => {
    calls.push({ origin, opId, args });
    if (origin === 'agents' && opId === 'getProfileProperties') return { ok: true, properties: { ...props } };
    if (origin === 'agents' && opId === 'setProfileProperty') { props[args.key] = { mode: 'own', value: args.value }; return { ok: true }; }
    if (origin === 'agents' && opId === 'setProfileDriver') { props[args.key] = { mode: 'own', value: { kind: args.kind, text: args.text, tags: args.tags, categoryId: args.categoryId } }; return { ok: true }; }
    if (origin === 'agents' && opId === 'setProfileDisclosure') return { ok: true };
    if (origin === 'stoop' && (opId === 'listMyOfferings' || opId === 'listMySkills')) return { skills: rosterSkills };
    return { ok: false, reason: `unstubbed ${origin}.${opId}` };
  };
  return { callSkill, calls, props };
}

const driverCalls = (calls) => calls.filter((c) => c.opId === 'setProfileDriver');
const disclosureCalls = (calls) => calls.filter((c) => c.opId === 'setProfileDisclosure');

describe('phase D — roster skills → root persona', () => {
  it('migrates a roster skill: freeTags become text+tags, categoryId preserved', async () => {
    const host = makeHost({ rosterSkills: [{ categoryId: 'klussen', freeTags: ['lekken', 'sanitair'] }] });
    const res = await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c1' });
    expect(res).toMatchObject({ ok: true, migrated: 1 });
    const [d] = driverCalls(host.calls);
    expect(d.args).toMatchObject({
      id: 'default', kind: 'offering', text: 'lekken sanitair', tags: ['lekken', 'sanitair'], categoryId: 'klussen',
    });
    expect(d.args.key).toBe(offeringKeyFor({ text: 'lekken sanitair', tags: 'lekken sanitair' }));
  });

  it('no freeTags → the taxonomy category (or the raw id) becomes the text', async () => {
    const host = makeHost({ rosterSkills: [{ categoryId: 'not-a-real-category', freeTags: [] }] });
    await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c1' });
    const [d] = driverCalls(host.calls);
    expect(d.args.text).toBe('not-a-real-category'); // unknown id falls back to itself
    expect(d.args.categoryId).toBe('not-a-real-category');
  });

  it('NO-SILENT-RETRACTION: the migrated circle gets disclosure at rung FULL, and only that circle', async () => {
    const host = makeHost({ rosterSkills: [{ categoryId: 'klussen', freeTags: ['dakgoot'] }] });
    await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c-here' });
    const disc = disclosureCalls(host.calls);
    expect(disc).toHaveLength(1);
    expect(disc[0].args).toMatchObject({ contextId: 'c-here', enabled: true, rung: 'full' });
  });

  it('is idempotent per circle via the marker (own-shaped value unwrapped)', async () => {
    const host = makeHost({ rosterSkills: [{ categoryId: 'klussen', freeTags: ['x'] }], markerValue: 'c1,c2' });
    const res = await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c1' });
    expect(res).toMatchObject({ ok: true, migrated: 0, already: true });
    expect(driverCalls(host.calls)).toHaveLength(0);
    // a NEW circle still migrates and extends the marker
    const res2 = await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c3' });
    expect(res2).toMatchObject({ ok: true, migrated: 1 });
    expect(host.props[OFFERINGS_MIGRATION_KEY].value).toBe('c1,c2,c3');
  });

  it('dedupes identical phrases on one roster; zero-skill circles still get the marker', async () => {
    const twice = [{ categoryId: 'klussen', freeTags: ['verf'] }, { categoryId: 'klussen', freeTags: ['verf'] }];
    const host = makeHost({ rosterSkills: twice });
    const res = await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c1' });
    expect(res.migrated).toBe(1);

    const empty = makeHost({ rosterSkills: [] });
    const res2 = await migrateRosterOfferings({ callSkill: empty.callSkill, circleId: 'c9' });
    expect(res2).toMatchObject({ ok: true, migrated: 0 });
    expect(empty.props[OFFERINGS_MIGRATION_KEY].value).toBe('c9'); // no rescan next load
  });

  it('honours the LEGACY marker key so a pre-rename circle never re-runs', async () => {
    const host = makeHost({ rosterSkills: [{ categoryId: 'klussen', freeTags: ['x'] }], legacyMarkerValue: 'c1,c2' });
    const res = await migrateRosterOfferings({ callSkill: host.callSkill, circleId: 'c1' });
    expect(res).toMatchObject({ ok: true, migrated: 0, already: true });
    expect(driverCalls(host.calls)).toHaveLength(0);
  });

  it('degrades safely: no circle / no profile → no-op with a reason', async () => {
    expect(await migrateRosterOfferings({ callSkill: async () => ({}), circleId: '' })).toMatchObject({ ok: false, reason: 'no-circle' });
    const noProfile = async (o, op) => (op === 'getProfileProperties' ? { ok: false } : {});
    expect(await migrateRosterOfferings({ callSkill: noProfile, circleId: 'c1' })).toMatchObject({ ok: false, reason: 'no-profile' });
  });
});
