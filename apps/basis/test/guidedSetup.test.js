/**
 * Settings chatbot — the template-driven guided-setup engine + remote loader.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_SETTINGS_TEMPLATE, isValidTemplate, startGuidedSetup, stepOf,
  submitGuidedStep, guidedPolicyPatch, loadSettingsTemplate,
} from '../src/v2/guidedSetup.js';
import { mergeCirclePolicy } from '../src/v2/circlePolicy.js';

describe('isValidTemplate', () => {
  it('accepts the bundled default + rejects malformed', () => {
    expect(isValidTemplate(DEFAULT_SETTINGS_TEMPLATE)).toBe(true);
    expect(isValidTemplate(null)).toBe(false);
    expect(isValidTemplate({ id: 'x' })).toBe(false);                    // no steps
    expect(isValidTemplate({ id: 'x', steps: {}, start: 'a' })).toBe(false);   // empty
    expect(isValidTemplate({ id: 'x', steps: { a: {} }, start: 'b' })).toBe(false); // start missing
  });
});

describe('guided-setup run (default template)', () => {
  it('walks intro → apps → storage → ai → done, collecting answers + signalling handoff', () => {
    const T = DEFAULT_SETTINGS_TEMPLATE;
    let s = startGuidedSetup(T);
    expect(stepOf(T, s).say).toMatch(/set up this circle/i);

    let r = submitGuidedStep(T, s, undefined);          // intro (say) → advance
    expect(r.applied).toBeNull();
    s = r.state;
    expect(stepOf(T, s).ask).toMatch(/which apps/i);

    r = submitGuidedStep(T, s, ['pinboard', 'tasks']);  // apps (multiselect)
    expect(r.applied).toEqual({ key: 'apps', value: ['pinboard', 'tasks'] });
    s = r.state;
    expect(stepOf(T, s).sets).toBe('storagePosture');

    r = submitGuidedStep(T, s, 'p2');                   // storage
    s = r.state;
    r = submitGuidedStep(T, s, 'user');                 // ai
    s = r.state;
    expect(stepOf(T, s).handoff).toBe(true);

    r = submitGuidedStep(T, s, undefined);              // done (handoff)
    expect(r.handoff).toBe(true);
    expect(r.done).toBe(true);
  });

  it('the collected answers build a valid circle-policy patch', () => {
    let s = startGuidedSetup(DEFAULT_SETTINGS_TEMPLATE);
    s = submitGuidedStep(DEFAULT_SETTINGS_TEMPLATE, s, undefined).state;
    s = submitGuidedStep(DEFAULT_SETTINGS_TEMPLATE, s, ['pinboard']).state;
    s = submitGuidedStep(DEFAULT_SETTINGS_TEMPLATE, s, 'p2').state;
    s = submitGuidedStep(DEFAULT_SETTINGS_TEMPLATE, s, 'user').state;
    const patch = guidedPolicyPatch(s);
    expect(patch).toEqual({ apps: ['pinboard'], storagePosture: 'p2', llmTool: 'user' });
    // and it normalizes onto a real policy
    const policy = mergeCirclePolicy({}, patch);
    expect(policy.apps).toEqual(['pinboard']);
    expect(policy.storagePosture).toBe('p2');
    expect(policy.llmTool).toBe('user');
  });

  it('a bad answer can’t corrupt the policy (normalizer rejects it)', () => {
    const patch = guidedPolicyPatch({ answers: { storagePosture: 'bogus', llmTool: 'nope' } });
    const policy = mergeCirclePolicy({}, patch);
    expect(policy.storagePosture).toBe('p0');   // default — invalid rejected
    expect(policy.llmTool).toBe('off');
  });
});

describe('loadSettingsTemplate (remote with fallback)', () => {
  it('uses a valid remote template', async () => {
    const remote = { id: 'remote', steps: { a: { say: 'hi' } }, start: 'a' };
    const fetchImpl = vi.fn(async () => ({ json: async () => remote }));
    expect(await loadSettingsTemplate({ url: 'https://hq/t.json', fetchImpl })).toBe(remote);
  });
  it('falls back to the bundled default on fetch error / invalid JSON / no url', async () => {
    expect(await loadSettingsTemplate({ url: 'https://hq/t.json', fetchImpl: async () => { throw new Error('down'); } }))
      .toBe(DEFAULT_SETTINGS_TEMPLATE);
    expect(await loadSettingsTemplate({ url: 'https://hq/t.json', fetchImpl: async () => ({ json: async () => ({ bad: 1 }) }) }))
      .toBe(DEFAULT_SETTINGS_TEMPLATE);
    expect(await loadSettingsTemplate({})).toBe(DEFAULT_SETTINGS_TEMPLATE);
  });
});
