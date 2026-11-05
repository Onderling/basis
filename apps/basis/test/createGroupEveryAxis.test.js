/**
 * A preset is a starting point: every policy axis the wizard writes is the person's to change — the pod type, every
 * feature, the reveal policy, agents, the LLM tool, consensus. A change survives a later switch of kind, and the policy
 * the create writes carries it.
 */
import { describe, it, expect } from 'vitest';
import { initialState, setKind, setLlmTool, setAgents, setConsensus, setFeature, policyPatchFromState,
  LLM_TOOL_CHOICES, AGENTS_CHOICES, FEATURE_CHOICES } from '../src/core/wizards/createGroupState.js';
import { CIRCLE_POLICY_ENUMS, CIRCLE_FEATURES } from '../src/v2/circlePolicy.js';

describe('the create wizard: every axis editable', () => {
  it('offers every value of every axis, with words that exist', () => {
    expect(LLM_TOOL_CHOICES.map((o) => o.id)).toEqual(CIRCLE_POLICY_ENUMS.llmTool);
    expect(AGENTS_CHOICES.map((o) => o.id)).toEqual(CIRCLE_POLICY_ENUMS.agents);
    expect(FEATURE_CHOICES.map((o) => o.id)).toEqual(CIRCLE_FEATURES);
    for (const o of [...LLM_TOOL_CHOICES, ...AGENTS_CHOICES, ...FEATURE_CHOICES]) expect(o.labelKey).toMatch(/^circle\.settings\.(opt|feat)\./);
  });

  it("the person's choices win over the preset, and survive a switch of kind", () => {
    let s = setKind(initialState(), 'household');
    s = setLlmTool(s, 'off');
    s = setAgents(s, 'no');
    s = setConsensus(s, true);
    s = setFeature(s, 'tasks', false);
    s = setFeature(s, 'chat', false);
    s = setKind(s, 'neighbourhood');
    expect(s.llmTool).toBe('off');
    expect(s.agents).toBe('no');
    expect(s.consensusRequired).toBe(true);
    expect(s.features.tasks).toBe(false);
    expect(s.features.chat).toBe(false);
  });

  it('the policy the create writes carries them', () => {
    let s = setKind(initialState(), 'friends');
    s = setLlmTool(setAgents(setConsensus(setFeature(s, 'calendar', true), true), 'yes'), 'cloud');
    const p = policyPatchFromState(s);
    expect(p).toMatchObject({ llmTool: 'cloud', agents: 'yes', governance: { changePolicy: 'admin-quorum' } });
    expect(p.features.calendar).toBe(true);
  });

  it('a value outside an axis is ignored', () => {
    const s = setKind(initialState(), 'team');
    expect(setLlmTool(s, 'mainframe').llmTool).toBe(s.llmTool);
    expect(setAgents(s, 'robots').agents).toBe(s.agents);
    expect(setFeature(s, 'teleport', true).features).toEqual(s.features);
  });
});
