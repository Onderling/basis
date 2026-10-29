/**
 * S5 — My-data key management wiring. @vitest-environment happy-dom
 *
 * The v2 My-data screen reuses the EXISTING restore wizard
 * (the slash/page renderers) rather than reimplementing them. This guards the
 * contract the host (`circleApp.js` showMyData → mountMyDataWizard) relies on:
 * the wizards render into an injected container and dispatch via the shared
 * `callSkill('pinboard', opId, args)` shape — the same `rawCallSkill` basis
 * passes everywhere else.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderRestoreFromMnemonicWizard } from '../src/web/wizards/restoreFromMnemonicWizard.js';

describe('My-data key-management wizards (reused renderers)', () => {
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
