/**
 * **Platform: web** (DOM-dependent). RN parallel: src/rn/wizards/recoveryFileWizardModal.js.
 *
 * The two recovery-file doors (plan A2): export (one step — the file is sealed to the owner's key, so
 * there is no passphrase to type) and import (choose a file → the circles come back). State in
 * src/core/wizards/recoveryFileState.js, shared with mobile.
 */
import { mkBody, mkActions, mkError, mkSubmitting, refreshActions } from './_wizardKit.js';
import {
  initialExportState, initialImportState, submitExport, submitImport, canImport, importErrorKey,
} from '../../core/wizards/recoveryFileState.js';
import { t } from '../../localisation.js';

export function renderRecoveryExportWizard({ container, doc, callSkill, onClose, onDispatched }) {
  const state = initialExportState();
  rerender();
  async function run() {
    rerender();
    await submitExport({ state, callSkill });
    if (state.file && typeof onDispatched === 'function') { try { onDispatched({ ok: true }); } catch { /* shell hook */ } }
    rerender();
  }
  function rerender() {
    container.innerHTML = '';
    const body = mkBody(doc, t('circle.wizard.recovery.export_title'), t('circle.wizard.recovery.export_intro'));
    if (state.file) {
      const p = doc.createElement('p'); p.className = 'cc-wizard-blurb';
      p.textContent = `${t('circle.wizard.recovery.export_ready')} ${state.circles} · ${state.filename}`;
      body.appendChild(p);
      const btn = doc.createElement('button'); btn.type = 'button';
      btn.className = 'cc-wizard-btn cc-wizard-btn-primary';
      btn.textContent = t('circle.wizard.recovery.download');
      btn.addEventListener('click', () => {
        try {
          const url = URL.createObjectURL(new Blob([state.file], { type: 'application/json' }));
          const a = doc.createElement('a'); a.href = url; a.download = state.filename;
          doc.body.appendChild(a); a.click(); doc.body.removeChild(a); URL.revokeObjectURL(url);
        } catch (err) { state.submitError = err?.message ?? String(err); rerender(); }
      });
      body.appendChild(btn);
    }
    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, t('circle.wizard.recovery.sealing'));
    container.appendChild(body);
    mkActions(container, doc, state.file
      ? [{ label: t('common.done'), onClick: onClose, kind: 'primary' }]
      : [
        { label: t('common.cancel'), onClick: onClose, kind: 'secondary', disabled: state.submitting },
        { label: t('circle.wizard.recovery.make'), onClick: run, kind: 'primary', disabled: state.submitting },
      ]);
  }
}

export function renderRecoveryImportWizard({ container, doc, callSkill, onClose, onDispatched }) {
  const state = initialImportState();
  rerender();
  async function run() {
    rerender();
    await submitImport({ state, callSkill });
    if (state.result && typeof onDispatched === 'function') { try { onDispatched({ ok: true, ...state.result }); } catch { /* shell hook */ } }
    rerender();
  }
  function rerender() {
    container.innerHTML = '';
    if (state.result) {
      const body = mkBody(doc, t('circle.wizard.recovery.import_done_title'), `${t('circle.wizard.recovery.import_done')} ${state.result.circles.length}`);
      const ul = doc.createElement('ul');
      for (const c of state.result.circles) { const li = doc.createElement('li'); li.textContent = c; ul.appendChild(li); }
      body.appendChild(ul);
      container.appendChild(body);
      mkActions(container, doc, [{ label: t('common.done'), onClick: onClose, kind: 'primary' }]);
      return;
    }
    const body = mkBody(doc, t('circle.wizard.recovery.import_title'), t('circle.wizard.recovery.import_intro'));
    const input = doc.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.className = 'cc-wizard-file';
    input.addEventListener('change', () => {
      const f = input.files?.[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { state.fileText = String(reader.result ?? ''); state.filename = f.name; refreshActions(container, { canImport: () => canImport(state) }); };
      reader.readAsText(f);
    });
    body.appendChild(input);
    mkError(body, doc, state.submitError ? t(importErrorKey(state.submitError)) : null);
    mkSubmitting(body, doc, state.submitting, t('circle.wizard.recovery.loading'));
    container.appendChild(body);
    mkActions(container, doc, [
      { label: t('common.cancel'), onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: t('circle.wizard.recovery.load'), onClick: run, kind: 'primary', validate: 'canImport', disabled: !canImport(state) },
    ]);
  }
}
