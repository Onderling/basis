/**
 * Wizard state-machines — unit tests covering the three wizards
 * split in (restoreFromMnemonic,
 * postAudience).  Zero DOM; pure functions + async submits with
 * stub callSkills.
 *
 * Coverage focus: validation rules, state transitions, error
 * surfacing.  Substrate-call payload shape is asserted via spied
 * callSkill so RN's wizard layer (when it ships) gets the same
 * contract for free.
 */
import { describe, it, expect, vi } from 'vitest';

// ── restoreFromMnemonic ─────────────────────────────────────────
import * as RFM from '../../../src/core/wizards/restoreFromMnemonicState.js';

describe('restoreFromMnemonicState', () => {
  it('initialState is step 1 with blank fields', () => {
    const s = RFM.initialState();
    expect(s.step).toBe(1);
    expect(s.mnemonic).toBe('');
    expect(s.understandsLoss).toBe(false);
    expect(s.confirmedNoUndo).toBe(false);
    expect(s.submitting).toBe(false);
    expect(s.submitError).toBe(null);
    expect(s.successResult).toBe(null);
  });

  it('mnemonicWordCount counts whitespace-separated tokens', () => {
    expect(RFM.mnemonicWordCount('')).toBe(0);
    expect(RFM.mnemonicWordCount('one')).toBe(1);
    expect(RFM.mnemonicWordCount('  one   two  ')).toBe(2);
    expect(RFM.mnemonicWordCount(null)).toBe(0);
  });

  it('isMnemonicValid accepts 12 or 24 words; rejects others', () => {
    expect(RFM.isMnemonicValid('one two three four five six seven eight nine ten eleven twelve')).toBe(true);
    expect(RFM.isMnemonicValid(Array(24).fill('w').join(' '))).toBe(true);
    expect(RFM.isMnemonicValid('one two three')).toBe(false);
    expect(RFM.isMnemonicValid('')).toBe(false);
    expect(RFM.isMnemonicValid(Array(13).fill('w').join(' '))).toBe(false);
  });

  it('canAdvanceFromConfirm requires both checkboxes', () => {
    expect(RFM.canAdvanceFromConfirm({ understandsLoss: false, confirmedNoUndo: false })).toBe(false);
    expect(RFM.canAdvanceFromConfirm({ understandsLoss: true,  confirmedNoUndo: false })).toBe(false);
    expect(RFM.canAdvanceFromConfirm({ understandsLoss: false, confirmedNoUndo: true  })).toBe(false);
    expect(RFM.canAdvanceFromConfirm({ understandsLoss: true,  confirmedNoUndo: true  })).toBe(true);
  });

  it('submitRestore happy-path: trims the mnemonic and restores the owner root only', async () => {
    const state = RFM.initialState();
    state.mnemonic = '  one two three four five six seven eight nine ten eleven twelve  ';
    const callSkill = vi.fn().mockResolvedValue({ ok: true, reloadRequired: true });
    await RFM.submitRestore({ state, callSkill });
    const trimmed = 'one two three four five six seven eight nine ten eleven twelve';
    expect(callSkill).toHaveBeenCalledWith('household', 'restoreOwnerPhrase', { mnemonic: trimmed });
    // the one call: the phrase's bytes are the root secret, so no in-process agent ever receives it
    expect(callSkill).toHaveBeenCalledTimes(1);
    expect(state.successResult).toEqual({ ok: true, reloadRequired: true });
    expect(state.submitError).toBe(null);
    expect(state.submitting).toBe(true);  // stays true until caller re-renders
  });

  it('submitRestore failure: sets submitError + resets submitting', async () => {
    const state = RFM.initialState();
    state.mnemonic = Array(12).fill('w').join(' ');
    const callSkill = vi.fn().mockRejectedValue(new Error('boom'));
    await RFM.submitRestore({ state, callSkill });
    expect(state.submitError).toBe('boom');
    expect(state.submitting).toBe(false);
    expect(state.successResult).toBe(null);
  });

  it('submitRestore treats {error:...} substrate replies as failures', async () => {
    const state = RFM.initialState();
    state.mnemonic = Array(12).fill('w').join(' ');
    const callSkill = vi.fn().mockResolvedValue({ error: 'invalid mnemonic' });
    await RFM.submitRestore({ state, callSkill });
    expect(state.submitError).toBe('invalid mnemonic');
    expect(state.successResult).toBe(null);
  });
});

// ── postAudience ────────────────────────────────────────────────
import * as PA from '../../../src/core/wizards/postAudienceState.js';

describe('postAudienceState', () => {
  it('initialState pre-seeds from args', () => {
    const s = PA.initialState({ text: 'hi', kind: 'offer', groupId: 'circle-x' });
    expect(s.text).toBe('hi');
    expect(s.kind).toBe('offer');
    expect(s.selectedCircle).toBe('circle-x');
    expect(s.minTrust).toBe('all');
    expect(s.availableCircles).toBe(null);    // loading state
  });

  it('initialState defaults when args are empty', () => {
    const s = PA.initialState();
    expect(s.text).toBe('');
    expect(s.kind).toBe('ask');
    expect(s.selectedCircle).toBe(null);
  });

  it('canSubmit requires non-blank text + not submitting', () => {
    expect(PA.canSubmit({ text: '', submitting: false })).toBe(false);
    expect(PA.canSubmit({ text: '  ', submitting: false })).toBe(false);
    expect(PA.canSubmit({ text: 'hi', submitting: true })).toBe(false);
    expect(PA.canSubmit({ text: 'hi', submitting: false })).toBe(true);
  });

  it('buildAudience omits empty slots', () => {
    const s = PA.initialState();   // all defaults
    expect(PA.buildAudience(s)).toEqual({});
  });

  it('buildAudience picks up minTrust / tags / distance / recipients', () => {
    const s = PA.initialState();
    s.minTrust   = 'trusted';
    s.tags       = ' tools, gardening ,, kids ';
    s.distanceKm = 5;
    s.recipients = 'webid:anne, webid:karl';
    expect(PA.buildAudience(s)).toEqual({
      minTrust:   'trusted',
      tags:       ['tools', 'gardening', 'kids'],
      distanceKm: 5,
      recipients: ['webid:anne', 'webid:karl'],
    });
  });

  it('buildPostRequestArgs includes targets when circle selected', () => {
    const s = PA.initialState({ text: 'need a ladder', kind: 'ask', groupId: 'b1' });
    const a = PA.buildPostRequestArgs(s);
    expect(a.text).toBe('need a ladder');
    expect(a.kind).toBe('ask');
    expect(a.groupId).toBe('b1');
    expect(a.targets).toEqual([{ kind: 'group', groupId: 'b1' }]);
    expect(a.audience).toBeUndefined();    // no audience opts set
  });

  it('loadAvailableCircles uses substrate reply + auto-selects when single', async () => {
    const state = PA.initialState();
    const callSkill = vi.fn().mockResolvedValue({ groupId: 'b1', title: 'My Circle' });
    await PA.loadAvailableCircles({ state, callSkill });
    expect(state.availableCircles).toEqual([{ id: 'b1', label: 'My Circle' }]);
    expect(state.selectedCircle).toBe('b1');   // auto-selected
  });

  it('loadAvailableCircles gracefully degrades on failure', async () => {
    const state = PA.initialState();
    const callSkill = vi.fn().mockRejectedValue(new Error('offline'));
    await PA.loadAvailableCircles({ state, callSkill });
    expect(state.availableCircles).toEqual([]);
    expect(state.selectedCircle).toBe(null);
  });

  it('submitPost happy-path: returns {result, state}', async () => {
    const state = PA.initialState({ text: 'need ladder', groupId: 'b1' });
    const callSkill = vi.fn().mockResolvedValue({ requestId: 'req-123' });
    const { result } = await PA.submitPost({ state, callSkill });
    expect(result).toEqual({ requestId: 'req-123' });
    expect(state.submitError).toBe(null);
    expect(callSkill.mock.calls[0][2].text).toBe('need ladder');
    expect(callSkill.mock.calls[0][2].groupId).toBe('b1');
  });

  it('submitPost failure: surfaces error + returns {state} (no result)', async () => {
    const state = PA.initialState({ text: 'x' });
    const callSkill = vi.fn().mockRejectedValue(new Error('substrate down'));
    const r = await PA.submitPost({ state, callSkill });
    expect(r.result).toBeUndefined();
    expect(state.submitError).toBe('substrate down');
  });
});
