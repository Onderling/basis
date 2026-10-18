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

    const create = [...container.querySelectorAll('button')].find((b) => /create backup/i.test(b.textContent));
    expect(create).toBeTruthy();
    create.click();
    await Promise.resolve(); await Promise.resolve();

    expect(callSkill).toHaveBeenCalledWith('pinboard', 'encryptedBackup', { passphrase: 'a-strong-passphrase' });
  });

  it('restore wizard reaches pinboard.restoreFromMnemonic after the destructive confirms', async () => {
    const callSkill = vi.fn(async () => ({ newPubKey: 'pk-new' }));
    const container = document.createElement('div');
    renderRestoreFromMnemonicWizard({ container, doc: document, callSkill, onClose: () => {}, onDispatched: () => {} });
    const phrase = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';

    // step 1 — enter a valid 12-word phrase, then Next →
    const input = container.querySelector('input');
    input.value = phrase; input.dispatchEvent(new Event('input'));
    [...container.querySelectorAll('button')].find((b) => /next/i.test(b.textContent)).click();

    // step 2 — tick both destructive confirms, then Continue →
    container.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change')); });
    [...container.querySelectorAll('button')].find((b) => /continue/i.test(b.textContent)).click();

    // step 3 — Restore now
    [...container.querySelectorAll('button')].find((b) => /restore now/i.test(b.textContent)).click();
    await Promise.resolve(); await Promise.resolve();

    expect(callSkill).toHaveBeenCalledWith('pinboard', 'restoreFromMnemonic', { mnemonic: phrase, confirm: true });
  });
});
