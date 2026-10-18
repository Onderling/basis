/**
 * interests→drivers fold-in (audit 4) — one-time seed of an `interest`-kind driver from
 * the learned Layer-2 interest signal (interestsMigration.js). Pins: topInterestTerms
 * selection/cap, marker idempotence, seeding the strongest terms as driver TAGS (kind
 * 'interest', text empty), the skip-but-mark case (no learned terms), and single-write repeats.
 */
import { describe, it, expect } from 'vitest';
import {
  migrateInterests, topInterestTerms,
  INTERESTS_MIGRATION_KEY, INTERESTS_DRIVER_KEY, INTERESTS_MAX_TERMS,
} from '../src/core/interestsMigration.js';

/** A callSkill stub over a tiny in-memory profile + a pinboard interest-profile snapshot. */
function makeHost({ topTerms = [], markerDone = false } = {}) {
  const calls = [];
  const props = {};
  const drivers = {};
  if (markerDone) props[INTERESTS_MIGRATION_KEY] = { mode: 'own', value: 'done' };
  const callSkill = async (origin, opId, args) => {
    calls.push({ origin, opId, args });
    if (origin === 'agents' && opId === 'getProfileProperties') return { ok: true, properties: { ...props } };
    if (origin === 'agents' && opId === 'setProfileProperty') { props[args.key] = { mode: 'own', value: args.value }; return { ok: true }; }
    if (origin === 'agents' && opId === 'setProfileDriver') { drivers[args.key] = { ...args }; return { ok: true, id: args.id, key: args.key }; }
    if (origin === 'pinboard' && opId === 'getInterestProfile') return { totalDocs: topTerms.length, topTerms };
    return { ok: false, reason: `unstubbed ${origin}.${opId}` };
  };
  return { callSkill, calls, props, drivers };
}

const term = (t, weight) => ({ term: t, weight });
const setDriverCalls = (calls) => calls.filter((c) => c.opId === 'setProfileDriver');
const setPropCalls = (calls) => calls.filter((c) => c.opId === 'setProfileProperty');

describe('topInterestTerms — strongest learned terms, capped', () => {
  it('keeps highest-weight-first order and caps at INTERESTS_MAX_TERMS', () => {
    const many = Array.from({ length: 20 }, (_, i) => term(`t${i}`, 20 - i));
    const out = topInterestTerms({ topTerms: many });
    expect(out).toHaveLength(INTERESTS_MAX_TERMS);
    expect(out[0]).toBe('t0');
  });
  it('drops empty/non-string terms and a missing list', () => {
    expect(topInterestTerms({ topTerms: [term('zeilen', 3), term('  ', 2), { weight: 1 }] })).toEqual(['zeilen']);
    expect(topInterestTerms(null)).toEqual([]);
  });
  it('honours a custom cap', () => {
    expect(topInterestTerms({ topTerms: [term('a', 3), term('b', 2), term('c', 1)] }, 2)).toEqual(['a', 'b']);
  });
});

describe('interests migration — seed one interest driver from the learned signal', () => {
  it('folds the strongest terms into ONE interest driver (tags carry it, text empty), marks done', async () => {
    const host = makeHost({ topTerms: [term('zeilen', 5), term('houtbewerking', 3)] });
    const res = await migrateInterests({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, seeded: ['zeilen', 'houtbewerking'] });
    const driver = host.drivers[INTERESTS_DRIVER_KEY];
    expect(driver).toMatchObject({ id: 'default', key: 'interests', kind: 'interest', text: '' });
    expect(driver.tags).toEqual(['zeilen', 'houtbewerking']);
    expect(host.props[INTERESTS_MIGRATION_KEY]).toMatchObject({ value: 'done' });
  });

  it('skips seeding when there are no learned terms, but still marks done (one-time)', async () => {
    const host = makeHost({ topTerms: [] });
    const res = await migrateInterests({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, skipped: true });
    expect(host.drivers[INTERESTS_DRIVER_KEY]).toBeUndefined();          // nothing seeded
    expect(host.props[INTERESTS_MIGRATION_KEY]).toMatchObject({ value: 'done' });
  });

  it('is idempotent — a set marker makes it a no-op (no writes)', async () => {
    const host = makeHost({ topTerms: [term('zeilen', 5)], markerDone: true });
    const res = await migrateInterests({ callSkill: host.callSkill });
    expect(res).toMatchObject({ ok: true, already: true });
    expect(setDriverCalls(host.calls)).toHaveLength(0);
    expect(setPropCalls(host.calls)).toHaveLength(0);
  });

  it('running twice writes only once (second run sees the marker)', async () => {
    const host = makeHost({ topTerms: [term('zeilen', 5)] });
    await migrateInterests({ callSkill: host.callSkill });
    const before = setDriverCalls(host.calls).length;
    const res2 = await migrateInterests({ callSkill: host.callSkill });
    expect(res2).toMatchObject({ already: true });
    expect(setDriverCalls(host.calls).length).toBe(before);             // no further driver writes
  });

  it('degrades cleanly without a callSkill', async () => {
    expect(await migrateInterests({})).toMatchObject({ ok: false, reason: 'no-callskill' });
  });
});
