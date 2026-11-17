/**
 * THE WEB PAIRING FORM GRANTS NOTHING WITHOUT THE PICK. @vitest-environment happy-dom
 * 'Apparaten & sleutels' → connect a screen, drawn by the web renderer over the shared pairing (`appScreenPairing.js`)
 * as circleApp composes it: a pasted offer shows three codes; 'Connect' before the right pick grants nothing (the op is
 * never called and the form says to pick first); a wrong pick grants nothing; the right pick shows the ticks and one
 * grant goes, with the offer's nonce.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { createAppScreenPairing } from '../../src/v2/appScreenPairing.js';
import { encodePairingOffer } from '../../src/v2/connectionPairing.js';
import { screenCode } from '../../src/v2/screenDoor.js';

const t = (k) => k;
const flush = () => new Promise((r) => { setTimeout(r, 0); });

function form() {
  const callSkill = vi.fn(async () => ({ ok: true }));
  const pairing = createAppScreenPairing({ callSkill, rand: () => 0.3 });
  const root = document.createElement('div');
  renderCircleMyData(root, {
    t, only: ['connection-add'],
    connectionChoices: { ops: [{ id: 'household.listOpenTasks', label: 'taken' }], sections: [] },
    screenPairing: pairing, onPaired: vi.fn(),
  });
  const input = root.querySelector('.cc-mydata__connection-offer');
  const note = () => root.querySelector('.cc-mydata__connection-note').textContent;
  // what the form shows: a step is done when this changes (its note, its ticks, a grant sent), never after N ticks
  const shown = () => [note(), root.querySelector('.cc-mydata__connection-picker')?.hidden, callSkill.mock.calls.length,
    root.querySelectorAll('.cc-mydata__connection-code').length].join('|');
  const answered = async (act) => {
    const before = shown();
    act();
    await vi.waitFor(() => { if (shown() === before) throw new Error('the form has not answered yet'); }, { timeout: 5_000, interval: 5 });
    await flush();
  };
  const paste = (text) => answered(() => { input.value = text; input.dispatchEvent(new Event('input')); });
  const confirm = () => answered(() => root.querySelector('.cc-mydata__connection-confirm').click());
  const pick = (button) => answered(() => button.click());
  return { root, callSkill, paste, note, confirm, pick };
}

describe('the web pairing form', () => {
  it('Connect before the pick grants nothing', async () => {
    const f = form();
    if (!f.root.querySelector('.cc-mydata__connection-offer')) throw new Error('the form did not render (props?)');
    await f.paste(encodePairingOffer({ viewPubKey: 'SCREEN', nonce: 'n1', label: 'keuken' }));
    expect(f.root.querySelectorAll('.cc-mydata__connection-code')).toHaveLength(3);
    expect(f.root.querySelector('.cc-mydata__connection-picker').hidden, 'no ticks before the pick').toBe(true);
    await f.confirm();
    expect(f.callSkill).not.toHaveBeenCalled();
    expect(f.note()).toBe('circle.mydata.connection_offer_pairing-no-pick');
  });

  it('a wrong pick grants nothing and says so', async () => {
    const f = form();
    await f.paste(encodePairingOffer({ viewPubKey: 'SCREEN', nonce: 'n2' }));
    const real = await screenCode('SCREEN', 'n2');
    const wrong = [...f.root.querySelectorAll('.cc-mydata__connection-code')].find((b) => b.dataset.code !== real);
    await f.pick(wrong);
    expect(f.note()).toBe('circle.mydata.connection_offer_pairing-wrong-code');
    await f.confirm();
    expect(f.callSkill).not.toHaveBeenCalled();
  });

  // The pick is checked against a SHA-256 (crypto.subtle), which under a busy CI pool takes longer than a fixed couple
  // of ticks: twice on 2026-11-17 the form was read while it still said "pick a code". The steps wait for what the form
  // says, not for a number of ticks; this case slows the hash on purpose so a fixed wait shows up red.
  it('a slow hash: the wrong pick still says so, the form is read when it has answered', async () => {
    const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (...a) => {
      await new Promise((r) => { setTimeout(r, 30); });
      return digest(...a);
    });
    try {
      const f = form();
      await f.paste(encodePairingOffer({ viewPubKey: 'SCREEN', nonce: 'n4' }));
      const real = await screenCode('SCREEN', 'n4');
      const wrong = [...f.root.querySelectorAll('.cc-mydata__connection-code')].find((b) => b.dataset.code !== real);
      await f.pick(wrong);
      expect(f.note()).toBe('circle.mydata.connection_offer_pairing-wrong-code');
    } finally { spy.mockRestore(); }
  });

  it('the right pick shows the ticks, and one grant goes', async () => {
    const f = form();
    await f.paste(encodePairingOffer({ viewPubKey: 'SCREEN', nonce: 'n3', label: 'keuken' }));
    const real = await screenCode('SCREEN', 'n3');
    await f.pick(f.root.querySelector(`.cc-mydata__connection-code[data-code="${real}"]`));
    expect(f.root.querySelector('.cc-mydata__connection-picker').hidden).toBe(false);
    f.root.querySelector('.cc-mydata__connection-picker input[type=checkbox]').checked = true;
    await f.confirm();
    expect(f.callSkill).toHaveBeenCalledTimes(1);
    expect(f.callSkill.mock.calls[0].slice(0, 2)).toEqual(['household', 'grantSurface']);
    expect(f.callSkill.mock.calls[0][2]).toMatchObject({ viewPubKey: 'SCREEN', nonce: 'n3', ops: ['household.listOpenTasks'] });
  });
});
