/**
 * A member's settings proposal carries only what they changed (applied over the policy as it is when an admin accepts
 * it), says in words what it changes, and asks the admin who has not answered yet to take it over or turn it down.
 */
import { describe, it, expect } from 'vitest';
import { policyPatch, mergeCirclePolicy, normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { policyChangeLines, policyProposalForAdmin, policyChangeText } from '../../src/v2/governanceAppWiring.js';

describe('the diff-only subject', () => {
  it('only the fields the member changed; a late accept keeps an admin\'s change made in between', () => {
    const before = normalizeCirclePolicy({ features: { tasks: false, calendar: true }, view: 'chat' });
    const edited = mergeCirclePolicy(before, { features: { tasks: true } });
    const patch = policyPatch(before, edited);
    expect(patch).toEqual({ features: { tasks: true } });
    // meanwhile the admin switched the view
    const now = mergeCirclePolicy(before, { view: 'screen' });
    const enacted = mergeCirclePolicy(now, patch);
    expect(enacted.view).toBe('screen');
    expect(enacted.features.tasks).toBe(true);
    expect(policyPatch(before, before)).toEqual({});
  });
});

describe('what a proposal changes, in words', () => {
  it('a feature on/off, an axis to its option, and the rest counted', () => {
    expect(policyChangeLines({ features: { tasks: true, calendar: false }, view: 'screen', apps: ['lists'], settings: { x: 1 } })).toEqual([
      { key: 'circle.settings.change_on', params: { whatKey: 'circle.settings.feat.tasks' } },
      { key: 'circle.settings.change_off', params: { whatKey: 'circle.settings.feat.calendar' } },
      { key: 'circle.settings.change_set', params: { whatKey: 'circle.settings.view', toKey: 'circle.settings.opt.screen' } },
      { key: 'circle.settings.change_other', params: { n: 2 } },
    ]);
  });
});

describe('the admin answers on their own settings screen', () => {
  const roster = [{ webid: 'a1', role: 'admin', name: 'Anne' }, { webid: 'm0', role: 'member', name: 'Bea' }];
  const proposals = [{ proposalId: 'p1', by: 'm0', subject: { features: { tasks: true } }, votes: [{ voter: 'm0', choice: 'yes' }] }];
  it('an admin who has not answered is asked; a member, or an admin who answered, is not', () => {
    expect(policyProposalForAdmin({ proposals, roster, myRef: 'a1' })).toEqual({
      proposalId: 'p1', who: 'Bea', changes: [{ key: 'circle.settings.change_on', params: { whatKey: 'circle.settings.feat.tasks' } }],
    });
    expect(policyProposalForAdmin({ proposals, roster, myRef: 'm0' })).toBe(null);
    expect(policyProposalForAdmin({ proposals: [{ ...proposals[0], votes: [{ voter: 'a1', choice: 'no' }] }], roster, myRef: 'a1' })).toBe(null);
  });
});

describe('the change in words', () => {
  it('each line translated with its labels', () => {
    const t = (k, p = {}) => ({ 'circle.settings.change_on': `${p.what} aan`, 'circle.settings.feat.tasks': 'Taken', 'circle.settings.change_other': `en ${p.n} andere` })[k] ?? k;
    expect(policyChangeText([{ key: 'circle.settings.change_on', params: { whatKey: 'circle.settings.feat.tasks' } }, { key: 'circle.settings.change_other', params: { n: 2 } }], t)).toBe('Taken aan, en 2 andere');
  });
});

