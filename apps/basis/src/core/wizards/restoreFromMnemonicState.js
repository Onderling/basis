/**
 * restoreFromMnemonic — state-machine helpers lifted from
 * src/web/wizards/restoreFromMnemonicWizard.js (2026-05-24).
 *
 * The web wizard's render layer keeps living in its original file
 * and imports these helpers; basis-mobile's eventual RN
 * wizard imports them too.  Zero DOM, zero RN — pure value
 * transforms + an async submit wrapping callSkill.
 */

/** Initial state for the wizard (step 1, all fields empty). */
export function initialState() {
  return {
    step:             1,            // 1..3
    mnemonic:         '',
    understandsLoss:  false,
    confirmedNoUndo:  false,
    submitting:       false,
    submitError:      null,
    successResult:    null,
  };
}

/** Count non-empty whitespace-separated tokens. */
export function mnemonicWordCount(mnemonic) {
  return String(mnemonic ?? '').trim().split(/\s+/).filter(Boolean).length;
}

/** A valid mnemonic has exactly 12 or 24 words. */
export function isMnemonicValid(mnemonic) {
  const n = mnemonicWordCount(mnemonic);
  return n === 12 || n === 24;
}

/**
 * Whether the confirm-step "Continue" button should be enabled.
 * Both destructive-action checkboxes must be ticked.
 */
export function canAdvanceFromConfirm(state) {
  return !!(state.understandsLoss && state.confirmedNoUndo);
}

/**
 * Submit the restore via callSkill('pinboard', 'restoreFromMnemonic', ...).
 * Pure function over state + callSkill — easy to unit-test with a stub
 * callSkill.  Returns the mutated state (caller re-renders).
 *
 * @param {object}   args
 * @param {object}   args.state                  the wizard's state object
 * @param {function} args.callSkill              (appOrigin, opId, args) => Promise<any>
 * @returns {Promise<object>}  the mutated state ({successResult,...} or {submitError,...})
 */
export async function submitRestore({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const mnemonic = state.mnemonic.trim();
    // Step 1b — install the OWNER ROOT first: persist the phrase + re-derive the
    // default profile (= the feedback pseudonym). Then run the legacy pinboard restore
    // for pod reattachment. Different identity vaults (cc-owner-root/cc-chat-id vs
    // cc-pinboard-id) → no conflict; both take effect on the caller's reload.
    const owner = await callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    if (owner?.error) throw new Error(owner.error);
    const result = await callSkill('pinboard', 'restoreFromMnemonic', {
      mnemonic,
      confirm:  true,
    });
    if (result?.error) throw new Error(result.error);
    state.successResult = result;
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
  }
  return state;
}
