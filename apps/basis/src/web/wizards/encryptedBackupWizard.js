/**
 * **Platform: web** (DOM-dependent). RN parallel pending.
 *
 * basis — C6 encrypted-backup wizard (2026-05-24).
 *
 * 2-step backup flow: passphrase entry → download.  Real skill:
 * stoop.encryptedBackup({passphrase}) which returns {blob} — a
 * passphrase-protected JSON snapshot of the calling actor's stoop
 * state.  Per stoop Phase I5 / functional-design-v1 § I5.
 *
 * UX: passphrase entered twice (confirmation), minimum 12 chars (we
 * advise but don't enforce — usability > paranoia at this size).
 * Download triggers via Blob → ObjectURL → invisible anchor click.
 *
 * Restore companion: the user uses the same blob + passphrase via a
 * future /restore-encrypted-backup wizard (when stoop ships
 * decryptBackup / restoreEncryptedBackup).  For V0 the round-trip
 * isn't user-driven from chat — just the export.
 */

import { mkBody, mkActions, mkField, mkError, mkSubmitting, mkSteps, refreshActions } from './_wizardKit.js';
import {
  initialState,
  canCreateBackup,
  suggestedFilename,
  submitCreateBackup,
} from '../../core/wizards/encryptedBackupState.js';
import { t } from '../../localisation.js';

export function renderEncryptedBackupWizard(opts) {
  const { container, doc, callSkill, onClose, onDispatched } = opts;
  const state = initialState();
  rerender();

  function rerender() {
    container.innerHTML = '';
    mkSteps(container, doc, ['Passphrase', 'Download'], state.step);
    if (state.step === 1) renderPassphraseStep();
    if (state.step === 2) renderDownloadStep();
  }

  function renderPassphraseStep() {
    const body = mkBody(doc, 'Encrypted backup',
      'A passphrase-protected snapshot of YOUR stoop state. The passphrase never leaves your device — without it the backup is useless.');

    mkField(body, doc, 'Passphrase', state.passphrase,
      (v) => {
        state.passphrase = v;
        refreshActions(container, { canSubmit: () => canCreateBackup(state) && !state.submitting });
      },
      { type: 'password', placeholder: 'minimum 12 characters recommended' });
    mkField(body, doc, 'Confirm passphrase', state.confirm,
      (v) => {
        state.confirm = v;
        refreshActions(container, { canSubmit: () => canCreateBackup(state) && !state.submitting });
      },
      { type: 'password' });

    const warn = doc.createElement('div');
    warn.className = 'cc-wizard-warn';
    warn.textContent = t('wizard.backup.passphrase_warning');
    body.appendChild(warn);

    mkError(body, doc, state.submitError);
    mkSubmitting(body, doc, state.submitting, 'Encrypting…');
    container.appendChild(body);

    mkActions(container, doc, [
      { label: 'Cancel', onClick: onClose, kind: 'secondary', disabled: state.submitting },
      { label: 'Create backup', validate: 'canSubmit', kind: 'primary',
        disabled: !canCreateBackup(state) || state.submitting,
        onClick: async () => {
          rerender(); // show submitting state
          await submitCreateBackup({ state, callSkill });
          if (state.blob && typeof onDispatched === 'function') {
            try { onDispatched({ ok: true, message: '✓ Encrypted backup created.' }); } catch {}
          }
          rerender();
        } },
    ]);
  }

  function renderDownloadStep() {
    const body = mkBody(doc, '✓ Backup ready',
      'Download + store the file somewhere safe. Email it to yourself, copy to a USB stick, sync to a cloud you trust — anywhere, since it\'s encrypted.');

    const blobText = typeof state.blob === 'string' ? state.blob : JSON.stringify(state.blob);
    const filename = suggestedFilename();

    const sizeKb = (new Blob([blobText]).size / 1024).toFixed(1);
    const stats = doc.createElement('p');
    stats.className = 'cc-wizard-blurb';
    stats.textContent = `Filename: ${filename} · Size: ${sizeKb} KB`;
    body.appendChild(stats);

    const downloadBtn = doc.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'cc-wizard-btn cc-wizard-btn-primary';
    downloadBtn.textContent = t('wizard.backup.download');
    downloadBtn.addEventListener('click', () => {
      try {
        const blob = new Blob([blobText], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = doc.createElement('a');
        a.href = url; a.download = filename;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch (err) {
        const msg = doc.createElement('div');
        msg.className = 'cc-wizard-error';
        msg.textContent = `Download failed: ${err?.message ?? err}`;
        body.appendChild(msg);
      }
    });
    body.appendChild(downloadBtn);

    container.appendChild(body);
    mkActions(container, doc, [
      { label: 'Done', onClick: onClose, kind: 'primary' },
    ]);
  }
}
