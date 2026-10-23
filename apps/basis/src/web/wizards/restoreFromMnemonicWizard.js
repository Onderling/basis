/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C3 restore-from-mnemonic wizard (2026-05-24).
 *
 * 3-step DESTRUCTIVE recovery wizard.  Mnemonic → confirmation →
 * actual restore.  Real skill: pinboard.restoreFromMnemonic({mnemonic,
 * confirm: true}) — overwrites the agent's seed in the vault + swaps
 * in a fresh AgentIdentity at runtime (per pinboard Phase 31).
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
    mkSteps(container, doc, [t('circle.wizard.restore.step_phrase'), t('circle.wizard.restore.step_confirm'), t('circle.wizard.restore.step_restore')], state.step);
    if (state.step === 1) renderMnemonicStep();
    if (state.step === 2) renderConfirmStep();
    if (state.step === 3) renderRestoreStep();
  }

  function renderMnemonicStep() {
    const body = mkBody(doc, t('circle.wizard.restore.title'), t('circle.wizard.restore.intro'));
    mkField(body, doc, t('circle.wizard.restore.phrase'), state.mnemonic, (v) => {
      state.mnemonic = v;
      // No rerender — would lose input focus.  Just refresh the
      // [Next] button's disabled state.
      refreshActions(container, { mnemonicOk: () => isMnemonicValid(state.mnemonic) });
    }, { placeholder: t('circle.wizard.restore.phrase_placeholder'), monospace: true, hint: t('circle.wizard.restore.phrase_hint') });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: t('common.cancel'), onClick: onClose, kind: 'secondary' },
      { label: t('common.next'), onClick: () => { state.step = 2; rerender(); }, kind: 'primary',
        disabled: !isMnemonicValid(state.mnemonic), validate: 'mnemonicOk' },
    ]);
  }

  function renderConfirmStep() {
    const body = mkBody(doc, t('circle.wizard.restore.confirm_title'), t('circle.wizard.restore.confirm_intro'));
    const warn = doc.createElement('div');
    warn.className = 'cc-wizard-warn';
    warn.textContent = t('circle.wizard.restore.identity_warning');
    body.appendChild(warn);
    // the person's CURRENT phrase, asked once before the two checks (copy, not a third check)
    const saved = doc.createElement('p');
    saved.className = 'cc-wizard-field-hint';
    saved.textContent = t('circle.wizard.restore.saved_question');
    body.appendChild(saved);
    mkCheck(body, doc, t('circle.wizard.restore.ack_lost'), state.understandsLoss, (v) => { state.understandsLoss = v; rerender(); });
    mkCheck(body, doc, t('circle.wizard.restore.ack_undone'), state.confirmedNoUndo, (v) => { state.confirmedNoUndo = v; rerender(); });
    container.appendChild(body);
    mkActions(container, doc, [
      { label: t('common.back'),    onClick: () => { state.step = 1; rerender(); }, kind: 'secondary' },
      { label: t('common.cancel'),    onClick: onClose, kind: 'secondary' },
      { label: t('common.next'),onClick: () => { state.step = 3; rerender(); }, kind: 'primary',
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
    mkSubmitting(body, doc, state.submitting, t('circle.wizard.restore.restoring'));
    container.appendChild(body);
    mkActions(container, doc, [
      { label: t('common.back'),     onClick: () => { state.step = 2; rerender(); }, kind: 'secondary', disabled: state.submitting },
      { label: t('common.cancel'),     onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: t('circle.wizard.restore.button'),onClick: async () => {
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
  // The circle list does not ride the phrase: after the reload, My data → "Load a recovery file" (or the pod
  // sign-in) brings it back. Said here, where the person is looking.
  const hint = doc.createElement('p'); hint.className = 'cc-wizard-blurb';
  hint.textContent = t('circle.wizard.recovery.after_restore_hint');
  body.appendChild(hint);
  container.appendChild(body);
  mkActions(container, doc, [
    { label: t('circle.update.reload'), onClick: () => { onClose(); globalThis.location?.reload?.(); }, kind: 'primary' },
    { label: t('common.close'),  onClick: onClose, kind: 'secondary' },
  ]);
}
