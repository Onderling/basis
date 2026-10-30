/**
 * ONE MEMBER PER PERSONA, AND ONLY YOUR OWN DEVICE CAN TELL.
 *
 * Two personas of one person cannot be told apart on the wire — that is unlinkability, by design — so a circle cannot
 * refuse a person's second persona. The person's own device can: it knows the circle it is asked to join is one it is
 * already in, as another persona of theirs. The join warns before that second membership is made.
 */
import { describe, it, expect } from 'vitest';
import { initialState, decodeInvite, prepareJoinIdentity, setPersona, secondPersonaWarning } from '../../src/core/wizards/joinGroupState.js';

const callSkill = async () => ({});
async function joining(circleId, { circles, profileIdOf }) {
  const state = initialState();
  state.invite = { groupId: circleId };
  await prepareJoinIdentity({ state, callSkill, circles, profileIdOf });
  return state;
}

describe('a second persona in a circle you are already in', () => {
  it('already in as "buurt", joining as yourself: the warning names "buurt"', async () => {
    const state = await joining('c1', { circles: [{ id: 'c1', name: 'Straat' }], profileIdOf: () => 'buurt' });
    expect(secondPersonaWarning(state)).toEqual({ personaId: 'buurt' });
  });

  it('joining again as the same persona: no warning (that is the same member)', async () => {
    const state = await joining('c1', { circles: [{ id: 'c1' }], profileIdOf: () => 'buurt' });
    setPersona(state, 'buurt');
    expect(secondPersonaWarning(state)).toBeNull();
  });

  it('a circle this device is not in: no warning', async () => {
    const state = await joining('c2', { circles: [{ id: 'c1' }], profileIdOf: () => 'buurt' });
    expect(secondPersonaWarning(state)).toBeNull();
  });

  it('a shell that does not say which persona a circle is: no warning, never a guess', async () => {
    const state = await joining('c1', { circles: [{ id: 'c1' }] });
    expect(secondPersonaWarning(state)).toBeNull();
  });
});
