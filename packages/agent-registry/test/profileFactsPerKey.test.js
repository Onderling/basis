/**
 * A profile's facts merge PER KEY between a person's devices. Until 2026-10-26 the newer facts won whole: a rename on
 * one device and a place + disclosure set on the other at the same moment lost one of them (the two-devices walk).
 * Now every property key and every (context, key) disclosure entry carries its own time; a landing takes, per key, the
 * newer side; a key removed keeps its time as a tombstone, so a stale copy cannot bring it back.
 */
import { describe, it, expect } from 'vitest';
import { profileFactsOf, withProfileFacts, stampChangedFacts, mergeProfileFacts, factsDiffer, FACTS_KEYS_KEY, isReservedPropertyKey } from '../index.js';
import { own } from '../src/profileProperties.js';

const base = { agentId: 'default', properties: { name: own('Anna') }, disclosure: { perContext: {} } };
/** One device's edit: the entry after, stamped the way the write seam stamps it. */
function edit(before, after, at) {
  const keyTimes = stampChangedFacts(before, after, at);
  return withProfileFacts(after, { ...profileFactsOf(after), factsAt: at, keyTimes });
}

describe('facts merge per key', () => {
  const seeded = edit({}, base, 100);

  it('a rename on A1 and a place + disclosure on A2 at the same time: both survive, on both', () => {
    const onA1 = edit(seeded, { ...seeded, properties: { ...seeded.properties, name: own('Anna B.') } }, 200);
    const onA2 = edit(seeded, {
      ...seeded,
      properties: { ...seeded.properties, place: own('Groningen') },
      disclosure: { perContext: { c1: { place: { enabled: true } } } },
    }, 201);
    for (const [here, there] of [[onA1, onA2], [onA2, onA1]]) {
      const m = mergeProfileFacts(profileFactsOf(here), profileFactsOf(there));
      expect(m.properties.name).toEqual(own('Anna B.'));
      expect(m.properties.place).toEqual(own('Groningen'));
      expect(m.disclosure.perContext.c1.place).toEqual({ enabled: true });
      expect(m.factsAt).toBe(201);
    }
  });

  it('the newer write of the SAME key wins', () => {
    const a = edit(seeded, { ...seeded, properties: { name: own('A') } }, 300);
    const b = edit(seeded, { ...seeded, properties: { name: own('B') } }, 301);
    expect(mergeProfileFacts(profileFactsOf(a), profileFactsOf(b)).properties.name).toEqual(own('B'));
    expect(mergeProfileFacts(profileFactsOf(b), profileFactsOf(a)).properties.name).toEqual(own('B'));
  });

  it('a removed key stays removed against a stale copy (its time is a tombstone)', () => {
    const withPlace = edit(seeded, { ...seeded, properties: { ...seeded.properties, place: own('X') } }, 400);
    const removed = edit(withPlace, { ...withPlace, properties: { name: own('Anna') } }, 500);
    const m = mergeProfileFacts(profileFactsOf(removed), profileFactsOf(withPlace));
    expect(m.properties.place).toBeUndefined();
  });

  it('an unchanged copy changes nothing (no churn)', () => {
    const m = mergeProfileFacts(profileFactsOf(seeded), profileFactsOf(seeded));
    expect(factsDiffer(withProfileFacts(seeded, m), seeded)).toBe(false);
  });

  it('a copy from before the per-key stamps: its keys count at its whole stamp', () => {
    const legacy = { properties: { name: own('Old'), place: own('Y') }, disclosure: { perContext: {} }, factsAt: 50, keyTimes: {} };
    const m = mergeProfileFacts(profileFactsOf(seeded), legacy);
    expect(m.properties.name).toEqual(own('Anna'));   // seeded's name at 100 beats the legacy 50
    expect(m.properties.place).toEqual(own('Y'));     // nothing here said place: the legacy value stands
  });

  it('the key times are the registry\'s own key', () => {
    expect(isReservedPropertyKey(FACTS_KEYS_KEY)).toBe(true);
  });
});

// A DRIVER TAKEN OFF on one device stays off when another device's OLDER facts — still holding the driver and its
// release in a circle — land: the removal is a per-key tombstone for the driver AND for each of its releases, written in
// the one write that takes it off (as the host's removeDriver writes it: removeOwn + forgetDisclosureKey).
describe('a driver removed on A, then B\'s older facts land on A', () => {
  it('the driver stays gone and its release stays forgotten', async () => {
    const { removeOwn, setOwn, forgetDisclosureKey, setDisclosure } = await import('../index.js');
    const offer = { kind: 'offering', text: 'fietsen repareren', tags: [] };
    const seeded = edit({}, base, 100);
    // both devices: the driver, released in circle c1 (A wrote it; B received it — the same facts)
    const withDriver = edit(seeded, {
      ...seeded,
      properties: setOwn(seeded.properties, 'offering:fietsen', offer),
      disclosure: setDisclosure(seeded.disclosure, 'c1', 'offering:fietsen', { enabled: true }),
    }, 200);
    const onB = withDriver;
    // A takes it off, later
    const onA = edit(withDriver, {
      ...withDriver,
      properties: removeOwn(withDriver.properties, 'offering:fietsen'),
      disclosure: forgetDisclosureKey(withDriver.disclosure, 'offering:fietsen'),
    }, 300);
    expect(profileFactsOf(onA).properties['offering:fietsen']).toBeUndefined();
    // B's older facts land on A (and the other way round: B catches up)
    for (const [here, there] of [[onA, onB], [onB, onA]]) {
      const landed = withProfileFacts(here, mergeProfileFacts(profileFactsOf(here), profileFactsOf(there)));
      expect(landed.properties['offering:fietsen'], 'the driver stays gone').toBeUndefined();
      expect(landed.disclosure?.perContext?.c1?.['offering:fietsen'], 'its release stays forgotten').toBeUndefined();
      expect(landed.properties.name).toEqual(own('Anna'));
    }
  });
});
