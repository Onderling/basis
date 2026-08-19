/**
 * basis — createGroupState wire-up tests for β.4 (kind-aware
 * "+ new circle" templates).  Verifies that `setKind` consumes the
 * `circleTemplates` substrate to fill policy axes in the wizard state
 * and respects user-set overrides.
 */
import { describe, it, expect } from 'vitest';
import {
  initialState, setKind, setChatEnabled, CIRCLE_KINDS,
} from '../../../src/core/wizards/createGroupState.js';
import { CIRCLE_TEMPLATES } from '../../../src/v2/circleTemplates.js';

describe('initialState', () => {
  it('starts with kind=null + no policy axes set', () => {
    const s = initialState();
    expect(s.kind).toBe(null);
    expect(s.features).toBeUndefined();
    expect(s.revealPolicy).toBeUndefined();
    expect(s.pod).toBeUndefined();
    expect(s.llmTool).toBeUndefined();
    expect(s.agents).toBeUndefined();
    // consensusRequired is also unset until a kind picks (or the user
    // toggles it explicitly).  Identity / governance defaults remain.
    expect(s.consensusRequired).toBeUndefined();
    expect(s.accessPolicy).toBe('invite-only');
  });
});

describe('setKind — fills policy axes from the template', () => {
  it('picking household fills features + all policy axes', () => {
    const s0 = initialState();
    const s1 = setKind(s0, 'household');
    expect(s1.kind).toBe('household');
    expect(s1.features).toEqual(CIRCLE_TEMPLATES.household.features);
    expect(s1.revealPolicy).toBe('open');
    expect(s1.pod).toBe('shared');
    expect(s1.llmTool).toBe('local');
    expect(s1.agents).toBe('admin-approval');
    expect(s1.consensusRequired).toBe(false);
    // Identity fields untouched.
    expect(s1.name).toBe('');
    expect(s1.accessPolicy).toBe('invite-only');
  });

  it('picking buurt fills the buurt template', () => {
    const s = setKind(initialState(), 'buurt');
    expect(s.kind).toBe('buurt');
    expect(s.features.noticeboard).toBe(true);
    expect(s.features.calendar).toBe(false);
    expect(s.revealPolicy).toBe('pairwise');
    expect(s.pod).toBe('personal');
    expect(s.consensusRequired).toBe(true);
  });

  it('picking an unknown kind falls back to _default', () => {
    const s = setKind(initialState(), 'unknownStyle');
    expect(s.kind).toBe('unknownStyle');
    expect(s.revealPolicy).toBe(CIRCLE_TEMPLATES._default.revealPolicy);
    expect(s.pod).toBe(CIRCLE_TEMPLATES._default.pod);
    expect(s.llmTool).toBe(CIRCLE_TEMPLATES._default.llmTool);
  });

  it('does not mutate the input state', () => {
    const s0 = initialState();
    const before = { ...s0 };
    setKind(s0, 'household');
    expect(s0).toEqual(before);
  });
});

describe('setKind — the USER\'s choices survive; a previous template\'s do not (decision 4, 2026-07-29)', () => {
  // See circleTemplates.js: the merge now keys on provenance rather than on "is it already set", so a
  // kind switch gives you the kind you asked for instead of the first one wearing a new label.

  it('a feature the user toggled before picking is not clobbered', () => {
    const s0 = setChatEnabled({ ...initialState(), features: {} }, false);   // an explicit choice
    const s1 = setKind(s0, 'household');
    expect(s1.features.chat).toBe(false);
    expect(s1.features.noticeboard).toBe(true);
    expect(s1.features.tasks).toBe(true);
  });

  it('THE CHANGE — switching kinds re-fills every axis the user never touched', () => {
    const s1 = setKind(initialState(), 'household');
    const s2 = setKind(s1, 'buurt');
    const fresh = setKind(initialState(), 'buurt');
    expect(s2.kind).toBe('buurt');
    for (const axis of ['revealPolicy', 'pod', 'llmTool', 'agents', 'consensusRequired']) {
      expect(s2[axis], `${axis} kept the household value`).toEqual(fresh[axis]);
    }
    expect(s2.features).toEqual(fresh.features);
  });

  it('…and a choice made along the way still survives it', () => {
    const buurt = setKind(initialState(), 'buurt');
    const chose = setChatEnabled(buurt, true);
    const swapped = setKind(chose, 'friends');
    expect(swapped.features.chat).toBe(true);
    // everything else now matches a fresh friends — the J-CW1 walk, as a test
    const fresh = setKind(initialState(), 'friends');
    expect(swapped.revealPolicy).toBe(fresh.revealPolicy);
    expect(swapped.features.tasks).toBe(fresh.features.tasks);
    expect(swapped.features.houseRules).toBe(fresh.features.houseRules);
  });
});

describe('CIRCLE_KINDS — re-exported from createGroupState', () => {
  it('exposes the four canonical kinds', () => {
    expect(CIRCLE_KINDS.slice().sort()).toEqual(
      ['buurt', 'friends', 'household', 'team'],
    );
  });
});
