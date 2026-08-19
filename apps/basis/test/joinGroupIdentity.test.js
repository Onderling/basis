/**
 * Phase-4 Wave B — join-time identity logic (persona/handle/reveal-default + the
 * cross-circle linkability KEY choice). Unit-tests the pure helpers in
 * joinGroupState.js; the wizard UI wiring is tested separately (DOM/L2).
 */
import { describe, it, expect } from 'vitest';
import {
  handleSuggestions,
  resolveJoinRevealPreset,
  existingSelvesFrom,
  setLinkChoice,
  isLinkableChoice,
  presentedCircleAddress,
  REVEAL_JOIN_FALLBACK,
} from '../src/core/wizards/joinGroupState.js';

describe('handleSuggestions — prior-handle sourced, no leak', () => {
  it('returns the joiner OWN prior handles, deduped/lowercased/valid, capped at 8', () => {
    const out = handleSuggestions(['Jan', 'jan', 'bad!!', 'piet', ''], 'ignored');
    expect(out).toEqual(['jan', 'piet']); // Jan/jan fold; bad!! + '' dropped
  });
  it('caps at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => `buur${i}`);
    expect(handleSuggestions(many, 'x')).toHaveLength(8);
  });
  it('falls back to a display-name candidate when there are no prior handles', () => {
    // string first arg == legacy display-name mode; array-but-empty == no priors
    expect(handleSuggestions('My Name')[0]).toBe('my-name');
    expect(handleSuggestions([], 'My Name')[0]).toBe('my-name');
  });
});

describe('resolveJoinRevealPreset — override > personal default > fallback', () => {
  it('override wins', () => {
    expect(resolveJoinRevealPreset({ personalDefault: 'handle', override: 'full' })).toBe('full');
  });
  it('personal default when no override', () => {
    expect(resolveJoinRevealPreset({ personalDefault: 'handle' })).toBe('handle');
  });
  it('an invalid override is ignored (never forces)', () => {
    expect(resolveJoinRevealPreset({ personalDefault: 'handle', override: 'bogus' })).toBe('handle');
  });
  it('falls back to profile when nothing set', () => {
    expect(resolveJoinRevealPreset({})).toBe(REVEAL_JOIN_FALLBACK);
    expect(REVEAL_JOIN_FALLBACK).toBe('profile');
  });
});

describe('existingSelvesFrom — one self per existing circle, excludes the joining one', () => {
  it('excludes the circle being joined and labels by name (fallback to id)', () => {
    const out = existingSelvesFrom(
      [{ id: 'a', name: 'Circle-West' }, { id: 'b' }, { id: 'join-me', name: 'X' }],
      'join-me',
    );
    expect(out).toEqual([{ circleId: 'a', name: 'Circle-West' }, { circleId: 'b', name: 'b' }]);
  });
  it('non-array → []', () => {
    expect(existingSelvesFrom(null, 'x')).toEqual([]);
  });
});

describe('the KEY choice — default fresh/unlinkable, guarded to known selves', () => {
  const stateWith = (selves) => ({ existingSelves: selves });

  it('defaults to fresh', () => {
    const s = stateWith([{ circleId: 'a' }]);
    setLinkChoice(s, '');
    expect(s.linkChoice).toBe('fresh');
    expect(isLinkableChoice(s)).toBe(false);
  });
  it('accepts only a circleId the joiner actually belongs to', () => {
    const s = stateWith([{ circleId: 'a' }, { circleId: 'b' }]);
    setLinkChoice(s, 'a');
    expect(s.linkChoice).toBe('a');
    expect(isLinkableChoice(s)).toBe(true);
  });
  it('an unknown/injected circleId falls back to fresh (no arbitrary linking)', () => {
    const s = stateWith([{ circleId: 'a' }]);
    setLinkChoice(s, 'not-my-circle');
    expect(s.linkChoice).toBe('fresh');
    expect(isLinkableChoice(s)).toBe(false);
  });
  it("explicit 'fresh' stays fresh", () => {
    const s = stateWith([{ circleId: 'a' }]);
    setLinkChoice(s, 'fresh');
    expect(s.linkChoice).toBe('fresh');
  });
});

describe('presentedCircleAddress — undefined for fresh, the chosen self address for a link', () => {
  const circleAddressFor = (id) => (id === 'a' ? 'addr-of-a' : null);

  it('fresh → undefined (the seam derives this circle own key)', () => {
    expect(presentedCircleAddress({ linkChoice: 'fresh' }, circleAddressFor)).toBeUndefined();
  });
  it('continue-as-self → re-presents that circle existing address (linkable, no new derivation)', () => {
    expect(presentedCircleAddress({ linkChoice: 'a' }, circleAddressFor)).toBe('addr-of-a');
  });
  it('a null/throwing presenter → undefined (safe)', () => {
    expect(presentedCircleAddress({ linkChoice: 'a' }, () => null)).toBeUndefined();
    expect(presentedCircleAddress({ linkChoice: 'a' }, () => { throw new Error('x'); })).toBeUndefined();
  });
});
