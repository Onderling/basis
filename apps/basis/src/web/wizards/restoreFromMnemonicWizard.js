/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C3 restore-from-mnemonic wizard (2026-05-24).
 *
 * 3-step DESTRUCTIVE recovery wizard.  Mnemonic → confirmation →
 * actual restore.  Real skill: stoop.restoreFromMnemonic({mnemonic,
 * confirm: true}) — overwrites the agent's seed in the vault + swaps
 * in a fresh AgentIdentity at runtime (per stoop Phase 31).
 *
 * High-stakes UX: the confirm step is a hard gate (user must check
 * "I understand this overwrites my current identity") + a second
 * checkbox if they have NO backup.  Per [[quality-over-cheap]] we
 * over-communicate the destructiveness.
 */

import { mkBody, mkActions, mkField, mkCheck, mkSteps, mkError, mkSubmitting, refreshActions } from './_wizardKit.js';
import {
  initialState,
  isMnemonicValid,
  canAdvanceFromConfirm,
  mnemonicWordCount,
  submitRestore,
} from '../../core/wizards/restoreFromMnemonicState.js';
import { t } from '../../localisation.js';

export function renderRestoreFromMnemonicWizard(opts) {
  const { container, doc, callSkill, onClose, onDispatched } = opts;

  const state = initialState();

  rerender();

  function rerender() {
    container.innerHTML = '';
    if (state.successResult) return renderSuccessStep(container, doc, state, onClose);
    mkSteps(container, doc, ['Mnemonic', 'Confirm', 'Restore'], state.step);
    if (state.step === 1) renderMnemonicStep();
    if (state.step === 2) renderConfirmStep();
    if (state.step === 3) renderRestoreStep();
  }

  function renderMnemonicStep() {
    const body = mkBody(doc, t('circle.wizard.restore.title'), t('circle.wizard.restore.intro'));
    mkField(body, doc, 'Mnemonic phrase', state.mnemonic, (v) => {
      state.mnemonic = v;
      // No rerender — would lose input focus.  Just refresh the
      // [Next] button's disabled state.
      refreshActions(container, { mnemonicOk: () => isMnemonicValid(state.mnemonic) });
    }, { placeholder: 'word1 word2 word3 ...', monospace: true, hint: 'Words separated by single spaces.' });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: 'Cancel', onClick: onClose, kind: 'secondary' },
      { label: 'Next →', onClick: () => { state.step = 2; rerender(); }, kind: 'primary',
        disabled: !isMnemonicValid(state.mnemonic), validate: 'mnemonicOk' },
    ]);
  }

  function renderConfirmStep() {
    const body = mkBody(doc, t('circle.wizard.restore.confirm_title'), t('circle.wizard.restore.confirm_intro'));
    const warn = doc.createElement('div');
    warn.className = 'cc-wizard-warn';
    warn.textContent = t('circle.wizard.restore.identity_warning');
    body.appendChild(warn);
    mkCheck(body, doc, 'I understand this REPLACES my current identity.', state.understandsLoss, (v) => { state.understandsLoss = v; rerender(); });
    mkCheck(body, doc, 'I have saved my current mnemonic somewhere safe (or I don\'t need it).', state.confirmedNoUndo, (v) => { state.confirmedNoUndo = v; rerender(); });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: '← Back',    onClick: () => { state.step = 1; rerender(); }, kind: 'secondary' },
      { label: 'Cancel',    onClick: onClose, kind: 'secondary' },
      { label: 'Continue →',onClick: () => { state.step = 3; rerender(); }, kind: 'primary',
        disabled: !canAdvanceFromConfirm(state) },
    ]);
  }

  function renderRestoreStep() {
    const body = mkBody(doc, t('circle.wizard.restore.apply_title'), t('circle.wizard.restore.apply_intro'));
    const summary = doc.createElement('div');
    summary.className = 'cc-wizard-blurb';
    summary.textContent = `Mnemonic: ${mnemonicWordCount(state.mnemonic)} words.  After restore you'll be using the new identity immediately.`;
    body.appendChild(summary);
    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, 'Restoring identity…');
    container.appendChild(body);
    mkActions(container, doc, [
      { label: '← Back',     onClick: () => { state.step = 2; rerender(); }, kind: 'secondary', disabled: state.submitting },
      { label: 'Cancel',     onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: 'Restore now',onClick: async () => {
        rerender(); // show submitting state
        await submitRestore({ state, callSkill });
        if (state.successResult && typeof onDispatched === 'function') {
          try { onDispatched({ ok: true, message: '✓ Identity restored. Reload to refresh the chat-shell.' }); } catch {}
        }
        rerender();
      }, kind: 'primary', disabled: state.submitting },
    ]);
  }
}

function renderSuccessStep(container, doc, state, onClose) {
  const body = mkBody(doc, t('circle.wizard.restore.done_title'), t('circle.wizard.restore.done_intro'));
  const newKey = doc.createElement('code');
  newKey.className = 'cc-wizard-code';
  newKey.textContent = state.successResult?.newPubKey ?? '(unknown)';
  body.appendChild(newKey);
  container.appendChild(body);
  mkActions(container, doc, [
    { label: 'Reload', onClick: () => { onClose(); globalThis.location?.reload?.(); }, kind: 'primary' },
    { label: 'Close',  onClick: onClose, kind: 'secondary' },
  ]);
}
