// Property layer Phase 0 — the disclosure mechanism + the typed vocabulary.
import { describe, it, expect } from 'vitest';
import { own, inherit } from '../src/profileProperties.js';
import { descriptor, createVocabulary, isPropertyType, PROPERTY_TYPES } from '../src/propertyVocabulary.js';
import { createDisclosurePolicy, setDisclosure, getDisclosure, releasedValues, releasedForMatching, isDisclosed, isMatchable, isRequestable, changedReleaseKeys, releaseUnchanged } from '../src/disclosure.js';
import { createDriver } from '../src/drivers.js';

// a tiny profile registry: id → { properties }
const reg = (profiles) => (id) => profiles[id] ?? null;

describe('propertyVocabulary', () => {
  it('validates descriptors + exposes type/ladder/coarsen', () => {
    const place = descriptor({
      key: 'place', type: 'coarse-enum', ladder: ['municipality', 'district', 'address'],
      coarsen: (v, rung) => (rung === 'municipality' && v && v.municipality ? v.municipality : v),
    });
    const vocab = createVocabulary([place, { key: 'goal', type: 'driver' }]);
    expect(vocab.type('place')).toBe('coarse-enum');
    expect(vocab.ladder('place')).toEqual(['municipality', 'district', 'address']);
    expect(vocab.type('goal')).toBe('driver');
    expect(vocab.has('nope')).toBe(false);
    expect(PROPERTY_TYPES).toContain('coded');
    expect(isPropertyType('made-up')).toBe(false);
  });

  it('coarsen reduces a value to a rung; missing coarsen fn → value unchanged; never throws', () => {
    const vocab = createVocabulary([
      descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality', 'address'],
        coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : `${v.address}, ${v.municipality}`) }),
      descriptor({ key: 'role', type: 'coarse-enum' }),   // no coarsen
    ]);
    expect(vocab.coarsen('place', { municipality: 'Groningen', address: 'Kerkstraat 12' }, 'municipality')).toBe('Groningen');
    expect(vocab.coarsen('role', 'resident', 'x')).toBe('resident');     // no coarsen fn → as-is
    // a value shape the coarsen fn can't reduce → undefined (fail-closed: withhold, never leak the fine value)
    expect(vocab.coarsen('place', 'a-plain-string', 'municipality')).toBeUndefined();
  });

  it('releasedValues WITHHOLDS a value its coarsen fn cannot reduce (fail-closed)', () => {
    const getProfile = reg({ default: { properties: { place: own('a-plain-string') } } });
    const vocab = createVocabulary([descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality'],
      coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : v) })]);   // expects {municipality}; string → undefined
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { enabled: true, rung: 'municipality' });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, { items: [{ key: 'place' }] }, policy, 'c', vocab))
      .toEqual({});   // withheld, not leaked raw
  });

  it('rejects an unknown type / a bad ladder', () => {
    expect(() => descriptor({ key: 'x', type: 'weird' })).toThrow(/unknown type/);
    expect(() => descriptor({ key: 'x', ladder: [1, 2] })).toThrow(/ladder/);
    expect(() => descriptor({ type: 'scalar' })).toThrow(/key required/);
  });
});

describe('disclosure policy — default-withhold', () => {
  it('a fresh policy shares nothing (default withhold, absent not marked)', () => {
    const getProfile = reg({ default: { properties: { place: own('Groningen'), role: own('resident') } } });
    const req = { items: [{ key: 'place' }, { key: 'role' }] };
    const policy = createDisclosurePolicy();
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circle-42')).toEqual({});
    expect(getDisclosure(policy, 'circle-42', 'place')).toEqual({ enabled: false, rung: null, matchable: false, requestable: false });
  });

  it('releases only enabled keys the request asks for; withheld absent', () => {
    const getProfile = reg({ default: { properties: { place: own('Groningen'), role: own('resident') } } });
    const req = { items: [{ key: 'place' }, { key: 'role' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'circle-42', 'place', { enabled: true });   // share place, withhold role
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circle-42'))
      .toEqual({ place: 'Groningen' });
  });

  it('is per-context: enabling for one circle does not leak to another', () => {
    const getProfile = reg({ default: { properties: { place: own('Groningen') } } });
    const req = { items: [{ key: 'place' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'circleA', 'place', { enabled: true });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circleA')).toEqual({ place: 'Groningen' });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circleB')).toEqual({});
  });

  it('resolves an INHERITED value (a persona inherits place from the default profile)', () => {
    const getProfile = reg({
      default: { properties: { place: own('Groningen') } },
      work:    { properties: { place: inherit() } },        // work persona inherits place
    });
    const req = { items: [{ key: 'place' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'werk-7', 'place', { enabled: true });
    expect(releasedValues({ getProfile, profileId: 'work', defaultProfileId: 'default' }, req, policy, 'werk-7'))
      .toEqual({ place: 'Groningen' });
  });

  it('coarsens the released value to the chosen rung via the vocabulary', () => {
    const getProfile = reg({ default: { properties: { place: own({ municipality: 'Groningen', address: 'Kerkstraat 12' }) } } });
    const vocab = createVocabulary([descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality', 'address'],
      coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : v) })]);
    const req = { items: [{ key: 'place' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { enabled: true, rung: 'municipality' });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'c', vocab))
      .toEqual({ place: 'Groningen' });   // fine address coarsened away
  });

  it('passes an opaque coded value through unchanged (medical hook — value is not a string)', () => {
    // §6: a property value may be a structured { code, system } — the layer never assumes a string.
    const coded = { code: '294505008', system: 'SNOMED', severity: 'severe' };
    const getProfile = reg({ default: { properties: { allergy: own(coded) } } });
    const req = { items: [{ key: 'allergy' }] };
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'clinic', 'allergy', { enabled: true });
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'clinic'))
      .toEqual({ allergy: coded });
  });

  it('setDisclosure is immutable (returns a new policy)', () => {
    const p0 = createDisclosurePolicy();
    const p1 = setDisclosure(p0, 'c', 'place', { enabled: true });
    expect(p0.perContext).toEqual({});
    expect(getDisclosure(p1, 'c', 'place').enabled).toBe(true);
  });
});

describe('three disclosure axes — disclosed · matchable · requestable (P4 foundation)', () => {
  const getProfile = reg({ default: { properties: { hobby: own('bird-watching') } } });
  const req = { items: [{ key: 'hobby' }] };

  it('matchable:true + disclosed:false — matchable is TRUE, disclosed FALSE, and the VALUE never leaks', () => {
    // the whole point: I do not publish my hobby, but the on-device matcher may check it.
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'circle-42', 'hobby', { matchable: true });
    expect(isMatchable(policy, 'circle-42', 'hobby')).toBe(true);
    expect(isDisclosed(policy, 'circle-42', 'hobby')).toBe(false);
    // matchable NEVER leaks the value — releasedValues keys off the disclosed axis only.
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circle-42')).toEqual({});
  });

  it('requestable defaults FALSE and is set independently of the other axes', () => {
    let policy = createDisclosurePolicy();
    expect(isRequestable(policy, 'circle-42', 'hobby')).toBe(false);               // default withhold
    policy = setDisclosure(policy, 'circle-42', 'hobby', { requestable: true });
    expect(isRequestable(policy, 'circle-42', 'hobby')).toBe(true);
    expect(isDisclosed(policy, 'circle-42', 'hobby')).toBe(false);                 // untouched
    expect(isMatchable(policy, 'circle-42', 'hobby')).toBe(false);                 // untouched
    // still no value released — requestable is not a value-release axis.
    expect(releasedValues({ getProfile, profileId: 'default', defaultProfileId: 'default' }, req, policy, 'circle-42')).toEqual({});
  });

  it('all three axes toggle INDEPENDENTLY — setting one never clobbers the others', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'hobby', { matchable: true });            // 1) matchable
    policy = setDisclosure(policy, 'c', 'hobby', { requestable: true });          // 2) requestable, matchable preserved
    policy = setDisclosure(policy, 'c', 'hobby', { enabled: true, rung: null });  // 3) disclosed, others preserved
    expect(getDisclosure(policy, 'c', 'hobby')).toEqual({ enabled: true, rung: null, matchable: true, requestable: true });
    // and toggling one back off leaves the rest intact
    policy = setDisclosure(policy, 'c', 'hobby', { matchable: false });
    expect(getDisclosure(policy, 'c', 'hobby')).toEqual({ enabled: true, rung: null, matchable: false, requestable: true });
  });

  it('a read surfaces all three axes', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'hobby', { enabled: true, matchable: true, requestable: true });
    expect(getDisclosure(policy, 'c', 'hobby')).toEqual({ enabled: true, rung: null, matchable: true, requestable: true });
  });

  it('backward-compat — an OLD policy with only {enabled,rung} reads as matchable:false/requestable:false', () => {
    // a legacy persisted policy, never touched by the new setter.
    const legacy = { perContext: { circle: { hobby: { enabled: true, rung: 'municipality' } } } };
    expect(getDisclosure(legacy, 'circle', 'hobby')).toEqual({ enabled: true, rung: 'municipality', matchable: false, requestable: false });
    expect(isDisclosed(legacy, 'circle', 'hobby')).toBe(true);
    expect(isMatchable(legacy, 'circle', 'hobby')).toBe(false);
    expect(isRequestable(legacy, 'circle', 'hobby')).toBe(false);
  });

  it('the three helpers default FALSE for an unknown key/context', () => {
    const policy = createDisclosurePolicy();
    expect(isDisclosed(policy, 'nope', 'nope')).toBe(false);
    expect(isMatchable(policy, 'nope', 'nope')).toBe(false);
    expect(isRequestable(policy, 'nope', 'nope')).toBe(false);
  });
});

describe('releasedForMatching — the matching surface, keyed off matchable, NOT disclosed (P4c)', () => {
  const getProfile = reg({ default: { properties: {
    hobby: own(createDriver({ kind: 'hobby', text: 'bird-watching', tags: ['bird-watching'] })),
    place: own('Groningen'),
  } } });
  const ctx = { getProfile, profileId: 'default', defaultProfileId: 'default' };

  it('a matchable:true + disclosed:false property is INCLUDED in releasedForMatching, EXCLUDED from releasedValues', () => {
    // THE INVARIANT: it matches, but never discloses.
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'circle-42', 'hobby', { matchable: true });   // matchable, NOT disclosed
    const req = { items: [{ key: 'hobby' }] };

    // surfaced to the matcher…
    expect(releasedForMatching(ctx, req, policy, 'circle-42')).toEqual({
      hobby: createDriver({ kind: 'hobby', text: 'bird-watching', tags: ['bird-watching'] }),
    });
    // …but absent from the disclosed/released (roster) set — the value never leaks that way.
    expect(releasedValues(ctx, req, policy, 'circle-42')).toEqual({});
    expect(isDisclosed(policy, 'circle-42', 'hobby')).toBe(false);
  });

  it('a disclosed:false property is absent from the disclosed set even while matchable surfaces it', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { matchable: true });          // matchable only
    // disclosed set: nothing (default-withhold, no marker)
    expect(releasedValues(ctx, { items: [{ key: 'place' }] }, policy, 'c')).toEqual({});
    // matching set: present
    expect(releasedForMatching(ctx, { items: [{ key: 'place' }] }, policy, 'c')).toEqual({ place: 'Groningen' });
  });

  it('a DISCLOSED-but-not-matchable property is released but NOT in the matching set (axes are independent)', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { enabled: true });            // disclosed, NOT matchable
    expect(releasedValues(ctx, { items: [{ key: 'place' }] }, policy, 'c')).toEqual({ place: 'Groningen' });
    expect(releasedForMatching(ctx, { items: [{ key: 'place' }] }, policy, 'c')).toEqual({});
  });

  it('a REQUESTABLE-but-not-matchable property is NOT in the matching set (requestable stays independent)', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'hobby', { requestable: true });        // requestable only
    expect(isRequestable(policy, 'c', 'hobby')).toBe(true);
    expect(releasedForMatching(ctx, { items: [{ key: 'hobby' }] }, policy, 'c')).toEqual({});   // not matchable → absent
    expect(releasedValues(ctx, { items: [{ key: 'hobby' }] }, policy, 'c')).toEqual({});        // not disclosed → absent
  });

  it('with NO request it surfaces EVERY matchable key for the context (the match-proposal path)', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'hobby', { matchable: true });
    policy = setDisclosure(policy, 'c', 'place', { matchable: true });
    policy = setDisclosure(policy, 'c', 'other', { requestable: true });        // not matchable → excluded
    expect(Object.keys(releasedForMatching(ctx, null, policy, 'c')).sort()).toEqual(['hobby', 'place']);
  });

  it('is per-context: matchable in one circle does not surface in another', () => {
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'circleA', 'hobby', { matchable: true });
    expect(Object.keys(releasedForMatching(ctx, null, policy, 'circleA'))).toEqual(['hobby']);
    expect(releasedForMatching(ctx, null, policy, 'circleB')).toEqual({});
  });

  it('changedReleaseKeys / releaseUnchanged — the profile-update propagation gate', () => {
    // unchanged (order-independent) → nothing moved
    expect(changedReleaseKeys({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
    expect(releaseUnchanged({ a: 1 }, { a: 1 })).toBe(true);
    // added / removed / edited all count, sorted
    expect(changedReleaseKeys({ a: 1 }, { a: 1, b: 2 })).toEqual(['b']);
    expect(changedReleaseKeys({ a: 1, b: 2 }, { b: 2 })).toEqual(['a']);
    expect(changedReleaseKeys({ a: 1 }, { a: 9 })).toEqual(['a']);
    // absent/null ≡ {} (the roster normalises an empty disclosure to null)
    expect(releaseUnchanged(null, {})).toBe(true);
    expect(changedReleaseKeys(null, { a: 1 })).toEqual(['a']);
    // object values (e.g. a sealed media ref) compare deeply
    const ref = { type: 'blob', ref: 'blob://x', enc: { sealed: true } };
    expect(releaseUnchanged({ pic: ref }, { pic: { ...ref } })).toBe(true);
    expect(changedReleaseKeys({ pic: ref }, { pic: { ...ref, ref: 'blob://y' } })).toEqual(['pic']);
  });

  it('fail-closed: a matchable value its coarsen fn cannot reduce is WITHHELD from the matcher too', () => {
    const gp = reg({ default: { properties: { place: own('a-plain-string') } } });
    const vocab = createVocabulary([descriptor({ key: 'place', type: 'coarse-enum', ladder: ['municipality'],
      coarsen: (v, rung) => (rung === 'municipality' ? v.municipality : v) })]);   // string → undefined
    let policy = createDisclosurePolicy();
    policy = setDisclosure(policy, 'c', 'place', { matchable: true, rung: 'municipality' });
    expect(releasedForMatching({ getProfile: gp, profileId: 'default', defaultProfileId: 'default' },
      { items: [{ key: 'place' }] }, policy, 'c', vocab)).toEqual({});   // withheld, not leaked raw
  });
});
