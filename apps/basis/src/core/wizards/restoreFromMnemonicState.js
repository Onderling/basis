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
    alreadyYou:       false,        // the phrase is the one this device already is (checkPhrase): nothing to restore
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
 * Submit the restore via callSkill('household', 'restoreOwnerPhrase', ...).
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
    // The phrase restores the OWNER ROOT and, from it, the person's chat identity (the address people reach) — both
    // take effect on the caller's reload. Nothing else: the in-process agents' keys are device-local and are never in
    // the phrase. (Until 2026-10-23 a second step wrote the phrase's bytes — the root secret — as the pinboard agent's
    // seed, and the contact card then named the root's public key.)
    const owner = await callSkill('household', 'restoreOwnerPhrase', { mnemonic });
    if (owner?.error) throw new Error(owner.error);
    if (owner?.ok !== true) throw new Error('restore-failed');
    state.successResult = owner;
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
  }
  return state;
}

/**
 * Step 1's "Next": ask whether this phrase is the one this device already is, BEFORE the confirm step (a check that
 * restores nothing: `restoreOwnerPhrase` with `checkOnly`). The device's own phrase stops here with `alreadyYou`, and
 * the person never reaches "will be lost" for a restore that would only forget the running self; another phrase goes
 * on to step 2. A check that fails is not a stop: the confirm step and the restore itself still decide.
 * @param {{state: object, callSkill: function}} args
 * @returns {Promise<object>} the mutated state
 */
export async function checkPhrase({ state, callSkill }) {
  state.alreadyYou = false;
  try {
    const r = await callSkill('household', 'restoreOwnerPhrase', { mnemonic: state.mnemonic.trim(), checkOnly: true });
    state.alreadyYou = r?.ok === true && r.alreadyYou === true;
  } catch { state.alreadyYou = false; }
  if (!state.alreadyYou) state.step = 2;
  return state;
}
