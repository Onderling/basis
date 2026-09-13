/**
 * recoveryFile — state helpers for the two recovery-file doors, shared by the web wizard and
 * the RN modal. Zero DOM, zero RN: value transforms + async submits over callSkill.
 *
 * Export: `household.exportRecoveryFile` → the sealed file text (the registry, sealed to the owner's
 * key — the phrase is the only secret). Import: `household.importRecoveryFile({file})` → the circles
 * that came back. Saving and picking the file is the platform layer's job.
 */

export function initialExportState() {
  return {
    submitting: false, submitError: null, file: null, filename: null, circles: 0,
    // Per circle, the person's choice: carry ONE other member's address so a new device can find the
    // circle again (Frits, 2026-09-11 — default on). Loaded by `loadExportChoices`; `null` until then.
    choices: null,
    // What the made file carries, per circle: the member's address, or null when nobody was there to ask.
    peers: null,
  };
}

/**
 * The circles the file would carry, each with the peer choice ON — the export door lists them with a
 * checkbox before the person makes the file.
 */
export async function loadExportChoices({ state, callSkill }) {
  try {
    const r = await callSkill('household', 'listRecoveryCircles', {});
    state.choices = (Array.isArray(r?.circles) ? r.circles : []).map((c) => ({ id: c.id, name: c.name ?? null, peer: true }));
  } catch { state.choices = []; }
  return state;
}

/** Flip one circle's peer choice. */
export function togglePeerChoice(state, circleId) {
  for (const c of state.choices ?? []) if (c.id === circleId) c.peer = !c.peer;
  return state;
}

/** The circles whose record carries a peer, as the export op takes them — or undefined for "all" when no choice was loaded. */
export function tickedPeerCircles(state) {
  if (!Array.isArray(state?.choices)) return undefined;
  return state.choices.filter((c) => c.peer).map((c) => c.id);
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
    const peers = tickedPeerCircles(state);
    const r = await callSkill('household', 'exportRecoveryFile', peers ? { peers } : {});
    if (!r?.ok || typeof r.file !== 'string') throw new Error(r?.error ?? 'export-failed');
    state.file = r.file; state.circles = r.circles ?? 0; state.filename = recoveryFilename();
    state.peers = r.peers ?? null;
  } catch (err) { state.submitError = err?.message ?? String(err); }
  state.submitting = false;
  return state;
}

export async function submitImport({ state, callSkill }) {
  state.submitting = true; state.submitError = null;
  try {
    const r = await callSkill('household', 'importRecoveryFile', { file: state.fileText });
    if (!r?.ok) throw Object.assign(new Error(r?.error ?? 'import-failed'), { code: r?.error });
    // `bootstrap`: the file named someone to ask per circle — the shell hands it to the same consume
    // the add-a-device offer uses, so the circles talk to this device again without a relaunch.
    state.result = { agents: r.agents ?? 0, circles: Array.isArray(r.circles) ? r.circles : [], bootstrap: r.bootstrap ?? null };
  } catch (err) { state.submitError = err?.code ?? err?.message ?? String(err); }
  state.submitting = false;
  return state;
}
