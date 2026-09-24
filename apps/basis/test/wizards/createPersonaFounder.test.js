/**
 * WHICH PERSONA FOUNDS A CIRCLE YOU MAKE — the create wizard asks, the default preselected (Frits 2026-09-24).
 *
 * Joining already asked (`joinGroupState.setPersona`); creating never did, so a circle a person made was founded
 * as nobody in particular — no release rode, and their other personas could found nothing. The create wizard now
 * carries the same choice, and a successful create pushes the chosen persona's release onto the new circle
 * through the same seam the pair roster uses (`shareRelease(circleId, personaId)`).
 *
 * The lens, not a second identity: the address that founds is the default profile's whatever is picked (one
 * identity runs — ledger L123). The persona decides which RELEASE rides, nothing else.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  initialState, finalSubmit, withPersonas,
} from '../../src/core/wizards/createGroupState.js';

const created = { groupId: 'c-1', code: 'X', expiresAt: 1 };
const okCall = async (app, op) => (op === 'createGroupV2' ? created : {});

function ready(persona) {
  const s = initialState();
  s.name = 'Buurt'; s.groupId = 'c-1';
  if (persona !== undefined) s.persona = persona;
  return s;
}

describe('the create wizard founds a circle AS a persona', () => {
  it('preselects the default persona — "a choice with a default"', () => {
    expect(initialState().persona).toBe('default');
  });

  it('pushes the chosen persona\'s release onto the new circle, after the create succeeded', async () => {
    const shareRelease = vi.fn(async () => ({ ok: true }));
    const { result } = await finalSubmit({ state: ready('buurt'), callSkill: okCall, shareRelease });
    expect(shareRelease).toHaveBeenCalledWith('c-1', 'buurt');
    expect(result.releaseShared).toBe(true);
  });

  it('shares nothing when the founder chose to start minimally', async () => {
    const shareRelease = vi.fn();
    const { result } = await finalSubmit({ state: ready(null), callSkill: okCall, shareRelease });
    expect(shareRelease).not.toHaveBeenCalled();
    expect(result.releaseShared).toBe(false);
  });

  it('a release that fails does not undo the circle — it is said, and the next Mij share retries', async () => {
    const shareRelease = vi.fn(async () => { throw new Error('offline'); });
    const { result, state } = await finalSubmit({ state: ready('default'), callSkill: okCall, shareRelease });
    expect(result.groupId).toBe('c-1');
    expect(result.releaseShared).toBe(false);
    expect(state.submitError).toBeNull();
  });

  it('no seam, no release — the programmatic creates (help circle, pair circles) are unchanged', async () => {
    const { result } = await finalSubmit({ state: ready('default'), callSkill: okCall });
    expect(result.groupId).toBe('c-1');
    expect(result.releaseShared).toBe(false);
  });

  it('never shares when the create itself failed', async () => {
    const shareRelease = vi.fn();
    const failing = async () => ({ error: 'nope' });
    const { state } = await finalSubmit({ state: ready('default'), callSkill: failing, shareRelease });
    expect(state.submitError).toBe('nope');
    expect(shareRelease).not.toHaveBeenCalled();
  });
});

describe('withPersonas — the picker\'s list, and a choice that must name one of them', () => {
  const personas = [{ id: 'default', name: 'Frits' }, { id: 'buurt', name: 'Buurt' }];

  it('keeps a choice that is on the list', () => {
    const s = withPersonas({ ...initialState(), persona: 'buurt' }, personas);
    expect(s.personas).toEqual(personas);
    expect(s.persona).toBe('buurt');
  });

  it('keeps "start minimally" — null is a choice, not a gap', () => {
    expect(withPersonas({ ...initialState(), persona: null }, personas).persona).toBeNull();
  });

  it('falls back to the default when the choice names a persona that no longer exists', () => {
    expect(withPersonas({ ...initialState(), persona: 'gone' }, personas).persona).toBe('default');
  });
});
