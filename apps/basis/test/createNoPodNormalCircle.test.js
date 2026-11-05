/**
 * Without a connected pod a new circle is a normal one, and the wizard says nothing about pods: a pod type made with
 * no pod only degraded to fan-out with a warning. The pod types are offered once the person has connected a pod.
 * `podConnected` is what the host knows (web and mobile set it); a programmatic create that never sets it is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { initialState, setKind, setStoragePolicy, storageChoices, finalSubmit } from '../src/core/wizards/createGroupState.js';

const created = () => {
  const calls = [];
  const callSkill = async (app, op, args) => { calls.push({ op, args }); return op === 'createGroupV2' ? { groupId: args.groupId, code: 'C', codeId: 'k' } : {}; };
  return { calls, callSkill };
};

describe('a circle made without a connected pod', () => {
  it('the radio offers only "no pod"', () => {
    expect(storageChoices({ podConnected: false }).map((o) => o.id)).toEqual(['none']);
    expect(storageChoices({ podConnected: true }).map((o) => o.id)).toContain('shared');
    expect(storageChoices({}).map((o) => o.id)).toContain('shared');
  });

  it('is made "none" even when a pod type was set, and says nothing', async () => {
    let s = setKind({ ...initialState(), groupId: 'g1', name: 'X', podConnected: false }, 'household');
    s = setStoragePolicy(s, 'shared');
    const { calls, callSkill } = created();
    await finalSubmit({ state: s, callSkill });
    const create = calls.find((c) => c.op === 'createGroupV2');
    expect(create.args.storagePolicy).toBe('none');
    expect(create.args.groupPodUri).toBeUndefined();
    expect(s.pod).toBe('none');
  });

  it('with a pod connected the choice stands', async () => {
    let s = setKind({ ...initialState(), groupId: 'g2', name: 'Y', podConnected: true }, 'household');
    s = { ...setStoragePolicy(s, 'shared'), groupPodUri: 'https://ann.pod/circles/g2/' };
    const { calls, callSkill } = created();
    await finalSubmit({ state: s, callSkill });
    expect(calls.find((c) => c.op === 'createGroupV2').args.storagePolicy).toBe('shared');
  });
});
