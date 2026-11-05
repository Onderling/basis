/**
 * ONE SELF PER CIRCLE ON A DEVICE, AND ONLY YOUR OWN DEVICE CAN TELL.
 *
 * Two personas of one person cannot be told apart on the wire — that is unlinkability, by design — so a circle cannot
 * refuse a person's second persona. The person's own device can: it knows the circle it is asked to join is one it is
 * already in, as another persona of theirs, and a device holds a circle as one self. The join refuses before that
 * second membership is made (from another device it can be done).
 */
import { describe, it, expect } from 'vitest';
import { initialState, decodeInvite, prepareJoinIdentity, setPersona, secondPersonaRefusal } from '../../src/core/wizards/joinGroupState.js';

const callSkill = async () => ({});
async function joining(circleId, { circles, profileIdOf }) {
  const state = initialState();
  state.invite = { groupId: circleId };
  await prepareJoinIdentity({ state, callSkill, circles, profileIdOf });
  return state;
}

describe('a second persona joining a circle this device is already in', () => {
  it('already in as "buurt", joining as yourself: refused, naming "buurt"', async () => {
    const state = await joining('c1', { circles: [{ id: 'c1', name: 'Straat' }], profileIdOf: () => 'buurt' });
    expect(secondPersonaRefusal(state)).toEqual({ personaId: 'buurt' });
  });

  it('joining again as the same persona: nothing in the way (that is the same member)', async () => {
    const state = await joining('c1', { circles: [{ id: 'c1' }], profileIdOf: () => 'buurt' });
    setPersona(state, 'buurt');
    expect(secondPersonaRefusal(state)).toBeNull();
  });

  it('a circle this device is not in: nothing in the way', async () => {
    const state = await joining('c2', { circles: [{ id: 'c1' }], profileIdOf: () => 'buurt' });
    expect(secondPersonaRefusal(state)).toBeNull();
  });

  it('a shell that does not say which persona a circle is: nothing in the way, never a guess', async () => {
    const state = await joining('c1', { circles: [{ id: 'c1' }] });
    expect(secondPersonaRefusal(state)).toBeNull();
  });

  it('the refusal reads as one sentence naming the persona already there', async () => {
    const { submitErrorText } = await import('../../src/core/wizards/joinGroupState.js');
    const t = (k, p) => `${k}|${JSON.stringify(p ?? {})}`;
    const state = { submitErrorKey: 'circle.join.wizard.persona.already_in', submitErrorParams: { personaId: 'buurt' }, personas: [{ id: 'buurt', name: 'Buurt' }] };
    expect(submitErrorText(state, t)).toBe('circle.join.wizard.persona.already_in|{"persona":"Buurt"}');
    expect(submitErrorText({ submitErrorKey: 'circle.x' }, t)).toBe('circle.x|{}');
    expect(submitErrorText({ submitError: 'raw' }, t)).toBe('raw');
  });
});
