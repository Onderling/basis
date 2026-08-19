// Personal-drivers matcher (#4) — on-device, explainable-only. Deterministic tag overlap + an
// optional injected LLM judge. Every surfaced match carries a plain-language reason; a raw score
// never gates (the explainability invariant that replaced TF-IDF).
import { describe, it, expect, vi } from 'vitest';
import {
  deriveSignature, sharedTags, jaccard, scoreDriver, matchDrivers, matchDriversSemantic, createDriver,
} from '../index.js';

const DRIVERS = {
  goals:   createDriver({ kind: 'goal',   text: 'learn to sail', tags: ['sailing', 'learning'] }),
  hobby:   createDriver({ kind: 'hobby',  text: 'board games',   tags: ['boardgames', 'social'] }),
};

describe('driver matcher (#4)', () => {
  it('deriveSignature normalises tags into the driver tag space', () => {
    expect(deriveSignature({ text: '  Sail trip ', tags: ['Sailing', 'sailing', 'Open Water'] }))
      .toEqual({ text: 'Sail trip', tags: ['sailing', 'open-water'] });
  });

  it('sharedTags + jaccard', () => {
    expect(sharedTags(['sailing', 'learning'], ['sailing', 'x'])).toEqual(['sailing']);
    expect(jaccard(['a', 'b'], ['a', 'b'])).toBe(1);
    expect(jaccard(['a', 'b'], ['b', 'c'])).toBeCloseTo(1 / 3);
    expect(jaccard([], [])).toBe(0);
  });

  it('scoreDriver: a match only when tags overlap, carrying the shared-tags reason', () => {
    const sig = deriveSignature({ tags: ['sailing', 'weekend'] });
    const m = scoreDriver(DRIVERS.goals, sig);
    expect(m.sharedTags).toEqual(['sailing']);
    expect(m.reason).toEqual({ kind: 'tags', tags: ['sailing'] });
    expect(m.kind).toBe('goal');
    expect(scoreDriver(DRIVERS.hobby, sig)).toBe(null);   // no overlap → no match
  });

  it('matchDrivers: only explainable (tag-overlapping) drivers, ranked by score', () => {
    const item = { tags: ['sailing', 'learning', 'boardgames'] };
    const matches = matchDrivers({ drivers: DRIVERS, signature: item });
    // both overlap; goals shares 2/... higher jaccard than hobby (shares 1)
    expect(matches.map((m) => m.key)).toEqual(['goals', 'hobby']);
    expect(matches[0].sharedTags).toEqual(['sailing', 'learning']);
    expect(matches.every((m) => m.reason.kind === 'tags')).toBe(true);
  });

  it('matchDrivers: no overlap ⇒ no matches (never an unexplainable one)', () => {
    expect(matchDrivers({ drivers: DRIVERS, signature: { tags: ['cooking'] } })).toEqual([]);
  });

  it('matchDrivers: accepts an array of driver values (keys null)', () => {
    const matches = matchDrivers({ drivers: [DRIVERS.goals], signature: { tags: ['sailing'] } });
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe(null);
  });

  it('matchDriversSemantic: without a judge == deterministic', async () => {
    const item = { tags: ['sailing'] };
    expect(await matchDriversSemantic({ drivers: DRIVERS, signature: item }))
      .toEqual(matchDrivers({ drivers: DRIVERS, signature: item }));
  });

  it('matchDriversSemantic: judge adds synonym matches (no shared tags) with ITS reason', async () => {
    // Item about "boating" — synonym of sailing, but NO tag overlap with any driver.
    const item = { text: 'weekend boating meetup', tags: ['boating', 'weekend'] };
    const judge = vi.fn(async ({ driver }) =>
      driver.kind === 'goal'
        ? { match: true, reason: 'boating is sailing by another name' }
        : { match: false });

    const matches = await matchDriversSemantic({ drivers: DRIVERS, signature: item, judge });
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe('goals');
    expect(matches[0].reason).toEqual({ kind: 'llm', text: 'boating is sailing by another name' });
    // judge was asked about the non-tag-overlapping drivers only
    expect(judge).toHaveBeenCalledTimes(2);
  });

  it('matchDriversSemantic: tag matches are NOT re-judged (cheaper + stronger) and rank first', async () => {
    const item = { text: 'learn to sail', tags: ['sailing'] };   // tag-overlaps `goals`
    const judge = vi.fn(async () => ({ match: true, reason: 'x' }));
    const matches = await matchDriversSemantic({ drivers: DRIVERS, signature: item, judge });
    // goals matched on tags (not judged); hobby had no overlap → judged, judge said match.
    expect(matches[0].key).toBe('goals');
    expect(matches[0].reason.kind).toBe('tags');
    expect(judge).toHaveBeenCalledTimes(1);          // only the non-overlapping `hobby`
    expect(judge).toHaveBeenCalledWith(expect.objectContaining({ driver: DRIVERS.hobby }));
  });

  it('matchDriversSemantic: a judge that throws never removes the deterministic layer', async () => {
    const item = { tags: ['sailing', 'boating'] };
    const judge = vi.fn(async () => { throw new Error('model offline'); });
    const matches = await matchDriversSemantic({ drivers: DRIVERS, signature: item, judge });
    expect(matches.map((m) => m.key)).toEqual(['goals']);   // tag layer stands
    expect(matches[0].reason.kind).toBe('tags');
  });
});

describe('driver matcher (#5) — profile + item bridge', () => {
  it('driversFromProperties keeps only driver values (drops coarse-enum etc.)', async () => {
    const { driversFromProperties, createDriver } = await import('../index.js');
    const props = {
      place: 'Groningen',                                     // coarse-enum string — not a driver
      ageBand: '35-54',
      goals: createDriver({ text: 'learn to sail', tags: ['sailing'] }),
    };
    expect(Object.keys(driversFromProperties(props))).toEqual(['goals']);
  });

  it('itemSignature prefers an explicit driverSignature, else falls back to text/tags', async () => {
    const { itemSignature } = await import('../index.js');
    expect(itemSignature({ driverSignature: { tags: ['Sailing'] }, text: 'ignored' })).toEqual({ text: '', tags: ['sailing'] });
    expect(itemSignature({ title: 'Weekend sail', tags: ['Sailing'] })).toEqual({ text: 'Weekend sail', tags: ['sailing'] });
  });

  it('itemSignature also reads a post\'s skillTags / requiredSkills (existing author tags)', async () => {
    const { itemSignature } = await import('../index.js');
    expect(itemSignature({ text: 'anyone?', skillTags: ['Sailing'], requiredSkills: ['Rigging'] }))
      .toEqual({ text: 'anyone?', tags: ['sailing', 'rigging'] });
    // explicit driverSignature still wins over skillTags
    expect(itemSignature({ driverSignature: { tags: ['boating'] }, skillTags: ['sailing'] }))
      .toEqual({ text: '', tags: ['boating'] });
  });

  it('matchProfileDrivers: matches an item against the profile\'s stored drivers', async () => {
    const { matchProfileDrivers, createDriver } = await import('../index.js');
    const properties = {
      place: 'Groningen',
      goals: createDriver({ kind: 'goal', text: 'learn to sail', tags: ['sailing', 'learning'] }),
    };
    const item = { title: 'anyone up for sailing lessons?', driverSignature: { tags: ['sailing'] } };
    const matches = await matchProfileDrivers({ properties, item });
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe('goals');
    expect(matches[0].reason).toEqual({ kind: 'tags', tags: ['sailing'] });
  });
});

describe('matchable-aware matcher (P4c) — profile↔profile on the matchable surface', () => {
  it('matchableSignature: flattens a releasedForMatching value-set into a normalised signature', async () => {
    const { matchableSignature, createDriver } = await import('../index.js');
    const candidateMatchable = {
      hobby: createDriver({ kind: 'hobby', text: 'bird watching', tags: ['Bird-Watching'] }),
      place: 'Groningen',                                    // a coarse-enum string → matches as a tag
    };
    expect(matchableSignature(candidateMatchable)).toEqual({ text: 'bird watching', tags: ['bird-watching', 'groningen'] });
  });

  it('two profiles both matchable on the same hobby → the matcher finds the match', async () => {
    const { releasedForMatching, matchProfilesMatchable } = await import('../index.js');
    const { own } = await import('../index.js');
    const { createDisclosurePolicy, setDisclosure, createDriver } = await import('../index.js');

    // My profile (the searcher) — my drivers never leave my device.
    const myProperties = { hobby: createDriver({ kind: 'hobby', text: 'birding', tags: ['bird-watching'] }) };

    // The candidate exposes their hobby as matchable-but-NOT-disclosed, on THEIR device.
    const candProfile = (id) => ({ default: { properties: {
      hobby: own(createDriver({ kind: 'hobby', text: 'bird-watching', tags: ['bird-watching'] })),
    } } }[id] ?? null);
    let candPolicy = createDisclosurePolicy();
    candPolicy = setDisclosure(candPolicy, 'circle-42', 'hobby', { matchable: true });
    const candidateMatchable = releasedForMatching(
      { getProfile: candProfile, profileId: 'default', defaultProfileId: 'default' }, null, candPolicy, 'circle-42');

    const matches = await matchProfilesMatchable({ properties: myProperties, candidateMatchable });
    expect(matches).toHaveLength(1);
    expect(matches[0].key).toBe('hobby');
    expect(matches[0].reason).toEqual({ kind: 'tags', tags: ['bird-watching'] });
  });

  it('no shared matchable tag ⇒ no match (never an unexplainable one)', async () => {
    const { matchProfilesMatchable, createDriver } = await import('../index.js');
    const myProperties = { hobby: createDriver({ kind: 'hobby', text: 'cooking', tags: ['cooking'] }) };
    const candidateMatchable = { hobby: createDriver({ kind: 'hobby', text: 'sailing', tags: ['sailing'] }) };
    expect(await matchProfilesMatchable({ properties: myProperties, candidateMatchable })).toEqual([]);
  });

  it('a candidate that exposed NOTHING matchable (empty set) yields no match', async () => {
    const { matchProfilesMatchable, createDriver } = await import('../index.js');
    const myProperties = { hobby: createDriver({ kind: 'hobby', text: 'birding', tags: ['bird-watching'] }) };
    expect(await matchProfilesMatchable({ properties: myProperties, candidateMatchable: {} })).toEqual([]);
  });
});
