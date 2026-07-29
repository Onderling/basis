/**
 * N1+E8 — buurt template chat-off default + size-driven chat advice.
 *
 * Frits 2026-06-02: a buurt is noticeboard-first with open chat OFF by
 * default; for a *large* buurt the wizard should advise keeping it off
 * (with reasoning); for a *small* buurt it should just ask.  Covers the
 * pure substrate (kringTemplates) + the wizard state helpers.
 */
import { describe, it, expect } from 'vitest';

import {
  KRING_TEMPLATES, SIZE_BANDS, bandForCount, recommendChat,
} from '../src/v2/kringTemplates.js';
import {
  initialState, setKind, setSize, setChatEnabled, chatAdvice, policyPatchFromState,
} from '../src/core/wizards/createGroupState.js';
import { createCirclePolicyStore, localStoragePolicyIo } from '../src/v2/circlePolicyStore.js';
import { isFeatureEnabled } from '../src/v2/circlePolicy.js';

describe('buurt template — chat off by default (N1)', () => {
  it('the buurt template ships chat:false (noticeboard-first)', () => {
    expect(KRING_TEMPLATES.buurt.features.chat).toBe(false);
  });
  it('other kinds keep their chat default', () => {
    expect(KRING_TEMPLATES.household.features.chat).toBe(true);
    expect(KRING_TEMPLATES.vriendenkring.features.chat).toBe(true);
  });
  it('setKind("buurt") yields features.chat === false', () => {
    expect(setKind(initialState(), 'buurt').features.chat).toBe(false);
  });
});

describe('bandForCount', () => {
  it('20+ is large, fewer is small, junk is null', () => {
    expect(bandForCount(50)).toBe('large');
    expect(bandForCount(20)).toBe('large');
    expect(bandForCount(19)).toBe('small');
    expect(bandForCount(3)).toBe('small');
    expect(bandForCount(0)).toBeNull();
    expect(bandForCount(NaN)).toBeNull();
    expect(bandForCount('5')).toBeNull();
  });
});

describe('recommendChat', () => {
  it('advises off for a large buurt (with a reason)', () => {
    expect(recommendChat({ kind: 'buurt', size: 'large' }))
      .toEqual({ value: false, mode: 'advise-off', reasonKey: 'circle.chatAdvice.buurtLarge' });
  });
  it('asks for a small buurt (default off, but prompt)', () => {
    expect(recommendChat({ kind: 'buurt', size: 'small' }))
      .toEqual({ value: false, mode: 'ask', reasonKey: 'circle.chatAdvice.buurtSmall' });
  });
  it('is a neutral off-default for a buurt with no size yet', () => {
    expect(recommendChat({ kind: 'buurt' }))
      .toEqual({ value: false, mode: 'default-off', reasonKey: 'circle.chatAdvice.buurtDefault' });
  });
  it('follows the template + gives no advice for non-buurt kinds', () => {
    expect(recommendChat({ kind: 'household', size: 'large' }))
      .toEqual({ value: true, mode: 'default', reasonKey: null });
    expect(recommendChat({ kind: 'team' }))
      .toEqual({ value: true, mode: 'default', reasonKey: null });
  });
});

describe('createGroupState — size + chat helpers', () => {
  it('initialState has size:null + chatUserSet:false', () => {
    const s = initialState();
    expect(s.size).toBeNull();
    expect(s.chatUserSet).toBe(false);
  });

  it('setSize records a valid band, rejects junk', () => {
    expect(setSize(initialState(), 'large').size).toBe('large');
    expect(setSize(initialState(), 'huge').size).toBeNull();
    expect(SIZE_BANDS).toContain('small');
  });

  it('chatAdvice reflects (kind, size) on the state', () => {
    let s = setKind(initialState(), 'buurt');
    expect(chatAdvice(s).mode).toBe('default-off');
    s = setSize(s, 'large');
    expect(chatAdvice(s).mode).toBe('advise-off');
    s = setSize(s, 'small');
    expect(chatAdvice(s).mode).toBe('ask');
  });

  it('setChatEnabled flips features.chat + marks chatUserSet', () => {
    const s = setChatEnabled(setKind(initialState(), 'buurt'), true);
    expect(s.features.chat).toBe(true);
    expect(s.chatUserSet).toBe(true);
  });
});

describe('persistence — wizard policy reaches the circle store (E8 link)', () => {
  /** Minimal Storage-shaped mock for localStoragePolicyIo. */
  function memStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  }

  it('a created buurt persists policy.features.chat === false', async () => {
    const state = setKind(initialState(), 'buurt');     // template → no chat in the conversation
    const store = createCirclePolicyStore(localStoragePolicyIo(memStorage()));
    // Send the patch the wizard actually sends. This used to hand-copy three fields, which is how it
    // drifted: when `policyPatchFromState` gained `kind` and `conversationKinds` (decision 3) the copy
    // silently kept testing the old shape, and `features.chat` — now derived from the kinds list — had
    // nothing to derive from.
    await store.update('buurt-westend', policyPatchFromState(state));
    const policy = await store.get('buurt-westend');
    expect(isFeatureEnabled(policy, 'chat')).toBe(false);
    expect(isFeatureEnabled(policy, 'noticeboard')).toBe(true);
  });

  it('a user override (chat on) persists chat === true', async () => {
    const state = setChatEnabled(setKind(initialState(), 'buurt'), true);
    const store = createCirclePolicyStore(localStoragePolicyIo(memStorage()));
    await store.update('buurt-westend', { features: state.features });
    expect(isFeatureEnabled(await store.get('buurt-westend'), 'chat')).toBe(true);
  });

  it('policyPatchFromState carries features + template axes (web/RN shared)', () => {
    const patch = policyPatchFromState(setKind(initialState(), 'buurt'));
    expect(patch.features.chat).toBe(false);
    expect(patch.revealPolicy).toBe('pairwise');   // from the buurt template
    expect(patch.pod).toBe('personal');
    // A bare state (no template) yields an empty patch.
    expect(policyPatchFromState(initialState())).toEqual({});
  });
});
