// reveal PRESETS over disclosure's `enabled` axis, and the delegation of the old
// `revealLadder` level names onto the presets. The per-attribute booleans stay the truth.
import { describe, it, expect } from 'vitest';
import {
  createDisclosurePolicy, setDisclosure, getDisclosure, isDisclosed, isMatchable, isRequestable,
  REVEAL_PRESETS, isRevealPreset, revealPresetRank, nextRevealPreset, applyRevealPreset, revealPresetOf,
  REVEAL_LEVELS, presetForRevealLevel, revealLevelForPreset, revealRank, nextRevealLevel,
} from '../index.js';

// A caller's per-tier key assignment for a context: handle floor is the pseudonym only (no attribute),
// profile = the presented self, full = everything the caller lists (cumulative on top).
const keysFor = (preset) => ({
  handle: [],
  profile: ['displayName', 'picture', 'bio'],
  full: ['realName', 'contact'],
}[preset] || []);

describe('reveal presets — the amount vocabulary handle → profile → full', () => {
  it('presets are named by amount, ordered least → most, no verified/identity name', () => {
    expect(REVEAL_PRESETS).toEqual(['handle', 'profile', 'full']);
    expect(isRevealPreset('profile')).toBe(true);
    expect(isRevealPreset('identity')).toBe(false);         // rejected name is NOT a preset
    expect(revealPresetRank('handle')).toBe(0);
    expect(revealPresetRank('full')).toBe(2);
    expect(revealPresetRank('nonsense')).toBe(-1);
    expect(nextRevealPreset('handle')).toBe('profile');
    expect(nextRevealPreset('full')).toBe('full');          // caps at the ceiling
    expect(nextRevealPreset('bogus')).toBe('handle');       // unknown → floor
  });

  it('handle is the FLOOR — nothing beyond the handle enabled', () => {
    let p = createDisclosurePolicy();
    // pre-enable something, then apply handle → it must be disabled back to the floor.
    p = setDisclosure(p, 'c', 'displayName', { enabled: true });
    p = applyRevealPreset(p, 'c', 'handle', { keysFor });
    expect(isDisclosed(p, 'c', 'displayName')).toBe(false);
    expect(isDisclosed(p, 'c', 'picture')).toBe(false);
    expect(isDisclosed(p, 'c', 'realName')).toBe(false);
    expect(revealPresetOf(p, 'c', { keysFor })).toBe('handle');
  });

  it('profile enables the presented-self attributes and no more', () => {
    let p = applyRevealPreset(createDisclosurePolicy(), 'c', 'profile', { keysFor });
    expect(isDisclosed(p, 'c', 'displayName')).toBe(true);
    expect(isDisclosed(p, 'c', 'picture')).toBe(true);
    expect(isDisclosed(p, 'c', 'bio')).toBe(true);
    expect(isDisclosed(p, 'c', 'realName')).toBe(false);    // full-tier keys stay off
    expect(isDisclosed(p, 'c', 'contact')).toBe(false);
    expect(revealPresetOf(p, 'c', { keysFor })).toBe('profile');
  });

  it('full is the CEILING — every listed key enabled', () => {
    let p = applyRevealPreset(createDisclosurePolicy(), 'c', 'full', { keysFor });
    for (const k of ['displayName', 'picture', 'bio', 'realName', 'contact']) {
      expect(isDisclosed(p, 'c', k)).toBe(true);
    }
    expect(revealPresetOf(p, 'c', { keysFor })).toBe('full');
  });

  it('a preset then hiding ONE key reads as "that preset minus the key"', () => {
    let p = applyRevealPreset(createDisclosurePolicy(), 'c', 'profile', { keysFor });
    // per-attribute booleans win: hide the picture individually.
    p = setDisclosure(p, 'c', 'picture', { enabled: false });
    expect(isDisclosed(p, 'c', 'picture')).toBe(false);
    expect(isDisclosed(p, 'c', 'displayName')).toBe(true);  // the rest of profile intact
    // no longer FULLY profile → reads as the floor it still satisfies (handle).
    expect(revealPresetOf(p, 'c', { keysFor })).toBe('handle');
  });

  it('applying a preset preserves the OTHER axes (rung / matchable / requestable)', () => {
    let p = createDisclosurePolicy();
    p = setDisclosure(p, 'c', 'displayName', { rung: 'coarse', matchable: true, requestable: true });
    p = applyRevealPreset(p, 'c', 'profile', { keysFor });
    const d = getDisclosure(p, 'c', 'displayName');
    expect(d.enabled).toBe(true);                            // preset set enabled…
    expect(d.rung).toBe('coarse');                           // …and left the rest untouched
    expect(isMatchable(p, 'c', 'displayName')).toBe(true);
    expect(isRequestable(p, 'c', 'displayName')).toBe(true);
  });

  it('is per-context and pure (returns a new policy)', () => {
    const p0 = createDisclosurePolicy();
    const p1 = applyRevealPreset(p0, 'circleA', 'full', { keysFor });
    expect(p0.perContext).toEqual({});                       // unchanged
    expect(revealPresetOf(p1, 'circleA', { keysFor })).toBe('full');
    expect(revealPresetOf(p1, 'circleB', { keysFor })).toBe('handle');   // other circle untouched → floor
  });

  it('an empty handle tier is vacuously satisfied → a fresh policy reads as the handle floor', () => {
    expect(revealPresetOf(createDisclosurePolicy(), 'c', { keysFor })).toBe('handle');
  });

  it('a non-empty handle floor not fully enabled reads as null (below the floor)', () => {
    const kf = (preset) => ({ handle: ['nickname'], profile: ['displayName'], full: ['realName'] }[preset] || []);
    expect(revealPresetOf(createDisclosurePolicy(), 'c', { keysFor: kf })).toBe(null);
    const p = applyRevealPreset(createDisclosurePolicy(), 'c', 'handle', { keysFor: kf });
    expect(revealPresetOf(p, 'c', { keysFor: kf })).toBe('handle');
  });

  it('validates inputs', () => {
    const p = createDisclosurePolicy();
    expect(() => applyRevealPreset(p, '', 'profile', { keysFor })).toThrow(/contextId required/);
    expect(() => applyRevealPreset(p, 'c', 'identity', { keysFor })).toThrow(/unknown preset/);
    expect(() => applyRevealPreset(p, 'c', 'profile', {})).toThrow(/keysFor/);
    expect(() => revealPresetOf(p, 'c', {})).toThrow(/keysFor/);
  });
});

describe('revealLadder ↔ preset delegation (round-trip, byte-identical level behaviour)', () => {
  it('the old level names map 1:1 onto the presets by rank', () => {
    expect(presetForRevealLevel('ephemeral')).toBe('handle');
    expect(presetForRevealLevel('persona')).toBe('profile');
    expect(presetForRevealLevel('identity')).toBe('full');
    // inverse round-trips
    for (const level of REVEAL_LEVELS) {
      expect(revealLevelForPreset(presetForRevealLevel(level))).toBe(level);
    }
    for (const preset of REVEAL_PRESETS) {
      expect(presetForRevealLevel(revealLevelForPreset(preset))).toBe(preset);
    }
  });

  it('level ordering resolves THROUGH the preset ordering', () => {
    // rank of a level == rank of its preset
    for (const level of REVEAL_LEVELS) {
      expect(revealRank(level)).toBe(revealPresetRank(presetForRevealLevel(level)));
    }
    expect(revealRank('nonsense')).toBe(-1);
    // next-level == the level for the next preset
    expect(nextRevealLevel('ephemeral')).toBe(revealLevelForPreset(nextRevealPreset('handle')));
    expect(nextRevealLevel('persona')).toBe('identity');
    expect(nextRevealLevel('identity')).toBe('identity');    // caps
    expect(nextRevealLevel('bogus')).toBe('ephemeral');      // unknown → floor
  });
});
