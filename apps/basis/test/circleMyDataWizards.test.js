/**
 * S5 — My-data key management wiring. @vitest-environment happy-dom
 *
 * The v2 My-data screen reuses the EXISTING encrypted-backup + restore wizards
 * (the slash/page renderers) rather than reimplementing them. This guards the
 * contract the host (`circleApp.js` showMyData → mountMyDataWizard) relies on:
 * the wizards render into an injected container and dispatch via the shared
 * `callSkill('pinboard', opId, args)` shape — the same `rawCallSkill` basis
 * passes everywhere else.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderEncryptedBackupWizard } from '../src/web/wizards/encryptedBackupWizard.js';
import { renderRestoreFromMnemonicWizard } from '../src/web/wizards/restoreFromMnemonicWizard.js';

describe('My-data key-management wizards (reused renderers)', () => {
  it('encrypted-backup wizard renders + dispatches pinboard.encryptedBackup with the passphrase', async () => {
    const callSkill = vi.fn(async (app, op) => {
      expect(app).toBe('pinboard');
      expect(op).toBe('encryptedBackup');
      return { blob: '{"sealed":"yes"}' };
    });
    const container = document.createElement('div');
    renderEncryptedBackupWizard({ container, doc: document, callSkill, onClose: () => {}, onDispatched: () => {} });

    const [pass, confirm] = container.querySelectorAll('input[type="password"]');
    pass.value = 'a-strong-passphrase'; pass.dispatchEvent(new Event('input'));
    confirm.value = 'a-strong-passphrase'; confirm.dispatchEvent(new Event('input'));

    const create = container.querySelector('.cc-wizard-btn-primary');   // the step's one primary button (its words come from the locale)
    expect(create).toBeTruthy();
    create.click();
    await Promise.resolve(); await Promise.resolve();

    expect(callSkill).toHaveBeenCalledWith('pinboard', 'encryptedBackup', { passphrase: 'a-strong-passphrase' });
  });

  it('restore wizard restores the owner root after the destructive confirms — and nothing else', async () => {
    const callSkill = vi.fn(async () => ({ ok: true, reloadRequired: true }));
    const container = document.createElement('div');
    renderRestoreFromMnemonicWizard({ container, doc: document, callSkill, onClose: () => {}, onDispatched: () => {} });
    const phrase = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

    // step 1 — enter a valid 12-word phrase, then Next →
    const input = container.querySelector('input');
    input.value = phrase; input.dispatchEvent(new Event('input'));
    container.querySelector('.cc-wizard-btn-primary').click();

    // step 2 — tick both destructive confirms, then Next →
    container.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change')); });
    container.querySelector('.cc-wizard-btn-primary').click();

    // step 3 — Restore now
    container.querySelector('.cc-wizard-btn-primary').click();
    await Promise.resolve(); await Promise.resolve();

    expect(callSkill).toHaveBeenCalledWith('household', 'restoreOwnerPhrase', { mnemonic: phrase });
    // the phrase never reaches an in-process agent (its bytes are the root secret)
    expect(callSkill.mock.calls.map((c) => c[1])).not.toContain('restoreFromMnemonic');
    // …and the success screen shows no key
    expect(container.querySelector('.cc-wizard-code')).toBe(null);
  });
});
