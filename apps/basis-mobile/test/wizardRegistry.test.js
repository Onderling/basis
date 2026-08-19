/**
 * conflictDispute state-machine smoke.
 *
 * Pins the portable state-machine contract that the RN
 * `ConflictDisputeWizardModal` consumes.  We do NOT import the
 * registry here because it transitively imports the RN modal
 * component (JSX), which vitest's vite-jsx pipeline doesn't parse
 * from a plain .js file outside src/rn/.  The registry's
 * single-entry behaviour is trivial; Detox verifies the modal
 * launch end-to-end.
 *
 * What this file pins:
 *   - initialState seeds args.id into aboutPostId
 *   - validators behave (matches what the RN modal disables Next on)
 *   - submitDispute fires stoop.postRequest with kind:'dispute'
 *   - formatDisputeText embeds the postId when present
 *
 * The web wizard (apps/basis/src/web/wizards/) has its own
 * test in basis's vitest suite; both surfaces depend on the
 * same conflictDisputeState.js.
 */
import { describe, it, expect } from 'vitest';

import {
  initialState, isSummaryValid, isProposalValid,
  submitDispute, formatDisputeText,
} from '../../basis/src/core/wizards/conflictDisputeState.js';

describe('Bundle F P2 — conflictDispute state-machine smoke (used by RN modal)', () => {
  it('initialState seeds args.id into aboutPostId', () => {
    const s = initialState({ id: 'post-42' });
    expect(s.aboutPostId).toBe('post-42');
    expect(s.step).toBe(1);
    expect(s.summary).toBe('');
  });

  it('validators reject too-short input', () => {
    expect(isSummaryValid('short')).toBe(false);
    expect(isSummaryValid('this is a long enough summary')).toBe(true);
    expect(isProposalValid('')).toBe(false);
    expect(isProposalValid('hello')).toBe(true);
  });

  it('submitDispute calls stoop.postRequest with kind:dispute', async () => {
    const calls = [];
    const callSkill = async (origin, opId, args) => {
      calls.push({ origin, opId, args });
      return { ok: true, id: 'req-99' };
    };
    const s = initialState({ id: 'post-42' });
    s.summary    = 'A real summary that\'s long enough';
    s.proposal   = 'an apology';
    s.escalation = 'mediation';
    const { result, state } = await submitDispute({ state: { ...s }, callSkill });
    expect(result?.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].origin).toBe('stoop');
    expect(calls[0].opId).toBe('postRequest');
    expect(calls[0].args.kind).toBe('dispute');
    expect(calls[0].args.text).toContain('A real summary');
    expect(calls[0].args.text).toContain('an apology');
    expect(state.successResult).toEqual(result);
  });

  it('formatDisputeText embeds aboutPostId when present', () => {
    const s = initialState({ id: 'post-42' });
    s.summary    = 'summary';
    s.proposal   = 'proposal';
    s.escalation = 'admin';
    const text = formatDisputeText(s);
    expect(text).toContain('summary');
    expect(text).toContain('proposal');
    expect(text).toContain('admin');
    expect(text).toContain('post-42');
  });
});
