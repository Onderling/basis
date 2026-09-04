/**
 * recoveryFile — state helpers for the two recovery-file doors, shared by the web wizard and
 * the RN modal. Zero DOM, zero RN: value transforms + async submits over callSkill.
 *
 * Export: `household.exportRecoveryFile` → the sealed file text (the registry, sealed to the owner's
 * key — the phrase is the only secret). Import: `household.importRecoveryFile({file})` → the circles
 * that came back. Saving and picking the file is the platform layer's job.
 */

export function initialExportState() {
  return { submitting: false, submitError: null, file: null, filename: null, circles: 0 };
}

export function initialImportState() {
  return { fileText: '', filename: null, submitting: false, submitError: null, result: null };
}

/** `onderling-herstel-2026-09-04T16-30-00.json` — a name a person recognises in a folder. */
export function recoveryFilename(now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `onderling-herstel-${stamp}.json`;
}

export const canImport = (state) => typeof state?.fileText === 'string' && state.fileText.trim().length > 0 && !state.submitting;

/** The translation key for an import refusal code (the shells render `t(key)`). */
export function importErrorKey(code) {
  if (code === 'not-your-file') return 'circle.wizard.recovery.err_not_yours';
  if (code === 'unreadable-file') return 'circle.wizard.recovery.err_unreadable';
  return 'circle.wizard.recovery.err_failed';
}

export async function submitExport({ state, callSkill }) {
  state.submitting = true; state.submitError = null;
  try {
    const r = await callSkill('household', 'exportRecoveryFile', {});
    if (!r?.ok || typeof r.file !== 'string') throw new Error(r?.error ?? 'export-failed');
    state.file = r.file; state.circles = r.circles ?? 0; state.filename = recoveryFilename();
  } catch (err) { state.submitError = err?.message ?? String(err); }
  state.submitting = false;
  return state;
}

export async function submitImport({ state, callSkill }) {
  state.submitting = true; state.submitError = null;
  try {
    const r = await callSkill('household', 'importRecoveryFile', { file: state.fileText });
    if (!r?.ok) throw Object.assign(new Error(r?.error ?? 'import-failed'), { code: r?.error });
    state.result = { agents: r.agents ?? 0, circles: Array.isArray(r.circles) ? r.circles : [] };
  } catch (err) { state.submitError = err?.code ?? err?.message ?? String(err); }
  state.submitting = false;
  return state;
}
