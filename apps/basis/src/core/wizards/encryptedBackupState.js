/**
 * encryptedBackup — state-machine helpers lifted from
 * src/web/wizards/encryptedBackupWizard.js (2026-05-24).
 *
 * Zero DOM, zero RN — pure value transforms + an async submit
 * wrapping callSkill.  The download step's blob-to-file dance is
 * inherently web-only (Blob + URL.createObjectURL); RN's parallel
 * uses expo-file-system or react-native-fs and stays in the
 * platform-specific wizard layer.
 */

/** Initial state for the wizard (step 1, blank fields). */
export function initialState() {
  return {
    step:         1,          // 1 = passphrase, 2 = download
    passphrase:   '',
    confirm:      '',
    submitting:   false,
    submitError:  null,
    blob:         null,
  };
}

/**
 * Whether the [Create backup] button should be enabled.  Requires
 * a non-empty passphrase that matches the confirmation.  Minimum
 * length is advisory (we don't enforce — usability > paranoia at
 * this size; cf. the wizard's UX comment).
 */
export function canCreateBackup(state) {
  const p = state.passphrase ?? '';
  return p.length > 0 && p === (state.confirm ?? '');
}

/**
 * Suggest a filename for the download.  Pure function so the RN
 * file-writer + the web anchor-download path both stay in sync.
 *
 * @param {Date}   [now=new Date()]
 * @returns {string}
 */
export function suggestedFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `pinboard-backup-${stamp}.json.enc`;
}

/**
 * Submit the backup via callSkill('pinboard', 'encryptedBackup', ...).
 * On success: sets state.blob + advances to step 2.
 * On failure: sets state.submitError; stays on step 1.
 *
 * @param {object}   args
 * @param {object}   args.state                   wizard state object (mutated)
 * @param {function} args.callSkill               (appOrigin, opId, args) => Promise<any>
 * @returns {Promise<object>}  the mutated state
 */
export async function submitCreateBackup({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const result = await callSkill('pinboard', 'encryptedBackup', { passphrase: state.passphrase });
    if (result?.error) throw new Error(result.error);
    if (!result?.blob) throw new Error('substrate returned no blob');
    state.blob       = result.blob;
    state.step       = 2;
    state.submitting = false;
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
  }
  return state;
}
