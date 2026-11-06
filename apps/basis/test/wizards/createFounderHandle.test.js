/**
 * A founder with no handle reached every member as `peer-xxxxxx` (exploratory walk, 2026-10-08): the create wizard never
 * asked, the join wizard did. Create now asks the founder's handle when their profile has none — the join wizard's
 * validation and suggestions — and sets it on the profile after the create (which tells every roster, the new circle
 * included). With a handle already, nothing is asked.
 */
import { describe, it, expect, vi } from 'vitest';
import { initialState, finalSubmit, loadFounderHandle, identityComplete, founderHandleSuggestionsFor } from '../../src/core/wizards/createGroupState.js';

const profile = (entry) => vi.fn(async (app, op) => {
  if (op === 'getMyProfile') return { entry };
  if (op === 'listMyHandles') return { handles: [] };
  if (op === 'createGroupV2') return { groupId: 'c-1', code: 'X' };
  if (op === 'setMyHandle') return { ok: true };
  return {};
});

describe("the founder's handle", () => {
  it('no handle on the profile → the step asks, with suggestions from the display name', async () => {
    const r = await loadFounderHandle({ callSkill: profile({ displayName: 'Bea Bakker' }) });
    expect(r.needsHandle).toBe(true);
    expect(r.handleSuggestions.length).toBeGreaterThan(0);
  });
  // The walk (2026-11-05): "Tester B", no handle yet, one earlier id-derived handle — the only suggestion was that
  // handle. The person's own name comes first; what they used before follows it.
  it("the founder's own name is the first suggestion, before any handle they used before", async () => {
    const callSkill = vi.fn(async (app, op) => {
      if (op === 'getMyProfile') return { entry: { displayName: 'Tester B' } };
      if (op === 'listMyHandles') return { handles: ['pzwopwk1'] };
      return {};
    });
    const r = await loadFounderHandle({ callSkill });
    expect(r.handleSuggestions[0]).toBe('tester-b');
    expect(r.handleSuggestions).toContain('pzwopwk1');
  });
  it('a circle founded as a named persona suggests that persona\'s name first', () => {
    const state = { persona: 'p-werk', personas: [{ id: 'p-werk', name: 'Werk Frits' }], profileName: 'Tester B', priorHandles: [] };
    expect(founderHandleSuggestionsFor(state)).toEqual(['werk-frits', 'tester-b']);
  });
  it('a handle already → nothing asked', async () => {
    expect((await loadFounderHandle({ callSkill: profile({ handle: 'bea' }) })).needsHandle).toBe(false);
  });
  it('the identity step cannot be left without a valid handle when one is needed', () => {
    const s = { ...initialState(), name: 'Buurt', groupId: 'abc123', needsHandle: true, handle: '' };
    expect(identityComplete(s)).toBe(false);
    expect(identityComplete({ ...s, handle: 'Bea!' })).toBe(false);
    expect(identityComplete({ ...s, handle: 'bea' })).toBe(true);
    expect(identityComplete({ ...s, needsHandle: false })).toBe(true);
  });
  it('after the create, the handle is set on the profile — and never before the create answered', async () => {
    const callSkill = profile({});
    const s = { ...initialState(), name: 'Buurt', groupId: 'c-1', needsHandle: true, handle: 'bea', persona: null };
    const { result, named } = await finalSubmit({ state: s, callSkill });
    expect(result.groupId).toBe('c-1');
    expect(await named).toBe(true);
    const ops = callSkill.mock.calls.map((c) => c[1]);
    expect(ops.indexOf('setMyHandle')).toBeGreaterThan(ops.indexOf('createGroupV2'));
    // named by the new circle, so a circle made AS a persona names the persona, never the default self
    expect(callSkill).toHaveBeenCalledWith('pinboard', 'setMyHandle', { handle: 'bea', groupId: 'c-1' });
  });
  it('no handle needed → setMyHandle is never called', async () => {
    const callSkill = profile({ handle: 'bea' });
    const { named } = await finalSubmit({ state: { ...initialState(), name: 'B', groupId: 'c-1', persona: null }, callSkill });
    expect(await named).toBe(false);
    expect(callSkill.mock.calls.map((c) => c[1])).not.toContain('setMyHandle');
  });
});
