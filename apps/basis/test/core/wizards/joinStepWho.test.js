// Join step 3, "who joins": one line naming the name members will see, and a fold for another name or more privacy.
// The name is for people (any letters, spaces, capitals); it is no longer an identifier with a format rule.
import { describe, it, expect } from 'vitest';
import {
  initialState, isValidName, joinName, joinAsLine, joinNeedsName, joinAsNewPersona, addressHintKey, setLinkChoice,
  finalSubmit, prepareJoinIdentity,
} from '../../../src/core/wizards/joinGroupState.js';

const t = (k, v) => (v ? `${k}|${JSON.stringify(v)}` : k);

function stateWith(over = {}) {
  return Object.assign(initialState(), over);
}

describe('the name a person uses in a circle', () => {
  it('takes any letters, spaces and capitals', () => {
    for (const n of ['Tester B', 'Jan', 'Émile de Vries', 'ab', 'J']) expect(isValidName(n)).toBe(true);
  });
  it('refuses nothing-but-space, a control character, and an over-long name', () => {
    for (const n of ['', '   ', 'a\u0007b', 'x'.repeat(41), null, 42]) expect(isValidName(n)).toBe(false);
  });
});

describe('who joins', () => {
  const personas = [{ id: 'default', name: 'default' }, { id: 'p-werk', name: 'Werk' }];

  it('is the person under their own name when nothing is chosen', () => {
    const s = stateWith({ personas, profileName: 'Frits' });
    expect(joinName(s)).toBe('Frits');
    expect(joinAsLine(s, t)).toBe('circle.join.wizard.join_as.line|{"name":"Frits"}');
    expect(joinNeedsName(s)).toBe(false);
  });
  it('is the chosen persona under its name', () => {
    const s = stateWith({ personas, profileName: 'Frits', persona: 'p-werk' });
    expect(joinName(s)).toBe('Werk');
  });
  it('is the other name typed in the fold, when there is one', () => {
    const s = stateWith({ personas, profileName: 'Frits', persona: 'p-werk', handle: '  Fietsfrits ' });
    expect(joinName(s)).toBe('Fietsfrits');
  });
  it('asks for a name only when there is none to join under', () => {
    const s = stateWith({ personas, profileName: '' });
    expect(joinName(s)).toBe('');
    expect(joinNeedsName(s)).toBe(true);
    expect(joinAsLine(s, t)).toBe('circle.join.wizard.join_as.no_name');
  });
});

describe('joining as a new persona', () => {
  it('makes the persona and joins as it', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push([app, op, args]);
      if (op === 'createProfile') return { agentId: 'p-new' };
      if (op === 'listAgents') return { agents: [{ agentId: 'p-new', role: 'profile', name: 'Buurtfrits' }] };
      return {};
    };
    const s = stateWith({ profileName: 'Frits' });
    const r = await joinAsNewPersona({ state: s, callSkill, name: ' Buurtfrits ' });
    expect(r).toEqual({ ok: true, personaId: 'p-new' });
    expect(calls[0]).toEqual(['agents', 'createProfile', { name: 'Buurtfrits' }]);
    expect(s.persona).toBe('p-new');
    expect(joinName(s)).toBe('Buurtfrits');
  });
  it('makes nothing without a name', async () => {
    const s = stateWith();
    expect(await joinAsNewPersona({ state: s, callSkill: async () => ({}), name: '  ' })).toEqual({ ok: false });
    expect(s.persona).toBe(null);
  });
});

describe('the sentence under the address says what the chosen address does', () => {
  it('a new address: the relay cannot tie your circles together, members of both can', () => {
    const s = stateWith({ existingSelves: [{ circleId: 'c-x', name: 'X' }] });
    expect(addressHintKey(s)).toBe('circle.join.wizard.link.hint');
  });
  it('the same address as in another circle: the relay and the members of both see it is one person', () => {
    const s = stateWith({ existingSelves: [{ circleId: 'c-x', name: 'X' }] });
    setLinkChoice(s, 'c-x');
    expect(addressHintKey(s)).toBe('circle.join.wizard.link.hint_same');
  });
});

describe('a failed join leaves the other-name field as the person left it', () => {
  it('the persona name is not written into the field when the failure is not about the name', async () => {
    const s = stateWith({
      personas: [{ id: 'p-werk', name: 'Werk' }], persona: 'p-werk', handle: '',
      invite: { groupId: 'g1', code: 'x' },
    });
    const callSkill = async () => { throw Object.assign(new Error('admin-unreachable'), { reason: 'admin-unreachable' }); };
    await finalSubmit({ state: s, callSkill });
    expect(s.submitErrorReason).not.toBe('handle-taken');
    expect(s.handle).toBe('');          // a later persona switch still moves the one line
    expect(joinName(s)).toBe('Werk');
  });
  it('a refused name stays in the field, to change', async () => {
    const s = stateWith({ personas: [{ id: 'p-werk', name: 'Werk' }], persona: 'p-werk', handle: '', invite: { groupId: 'g1', code: 'x' } });
    const callSkill = async () => { throw Object.assign(new Error('handle-taken'), { reason: 'handle-taken' }); };
    await finalSubmit({ state: s, callSkill });
    expect(s.submitErrorReason).toBe('handle-taken');
    expect(s.handle).toBe('Werk');
  });
});

describe('the stored name in circles is a last resort, never a key piece', () => {
  const KEY = 'pZWOPwK1R5XsnsQ3d7tYb2kVfA9mLcE4hJ6uW8xN0rT';
  it('a stored handle never beats the name: "tester-b" + name "Tester B" says "Tester B"', () => {
    const s = stateWith({ profileName: 'Tester B', personaHandles: { default: 'tester-b' }, ownIds: [KEY] });
    expect(joinName(s)).toBe('Tester B');
  });
  it('no name and a stored handle made from the key: the fold asks, never the slug', () => {
    const s = stateWith({ profileName: '', personaHandles: { default: 'pzwopwk1' }, ownIds: [KEY] });
    expect(joinName(s)).toBe('');
    expect(joinNeedsName(s)).toBe(true);
  });
  it('no name and a real stored name: that name', () => {
    const s = stateWith({ profileName: '', personaHandles: { default: 'Frits B' }, ownIds: [KEY] });
    expect(joinName(s)).toBe('Frits B');
  });
  it('is loaded with the step: your own profile for the default persona, the persona view for the others', async () => {
    const callSkill = async (app, op, args) => {
      if (op === 'getMyProfile') return { entry: { webid: KEY, displayName: 'Frits', handle: 'Frits B' } };
      if (op === 'listAgents') return { agents: [{ agentId: 'default', role: 'profile', name: 'default' }, { agentId: 'p-werk', role: 'profile', name: 'Werk' }] };
      if (op === 'getPersonaView' && args.id === 'p-werk') return { properties: { handle: 'Frits van Werk' } };
      return {};
    };
    const s = stateWith();
    await prepareJoinIdentity({ state: s, callSkill, circles: [] });
    expect(s.profileName).toBe('Frits');
    expect(s.personaHandles).toEqual({ default: 'Frits B', 'p-werk': 'Frits van Werk' });
    expect(s.ownIds).toEqual([KEY]);
  });
});
