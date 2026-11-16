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
  const paste = async (text) => { input.value = text; input.dispatchEvent(new Event('input')); await flush(); await flush(); };
  const note = () => root.querySelector('.cc-mydata__connection-note').textContent;
  const confirm = async () => { root.querySelector('.cc-mydata__connection-confirm').click(); await flush(); await flush(); };
  return { root, callSkill, paste, note, confirm };
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
    wrong.click(); await flush(); await flush();
    expect(f.note()).toBe('circle.mydata.connection_offer_pairing-wrong-code');
    await f.confirm();
    expect(f.callSkill).not.toHaveBeenCalled();
  });

  it('the right pick shows the ticks, and one grant goes', async () => {
    const f = form();
    await f.paste(encodePairingOffer({ viewPubKey: 'SCREEN', nonce: 'n3', label: 'keuken' }));
    const real = await screenCode('SCREEN', 'n3');
    f.root.querySelector(`.cc-mydata__connection-code[data-code="${real}"]`).click(); await flush(); await flush();
    expect(f.root.querySelector('.cc-mydata__connection-picker').hidden).toBe(false);
    f.root.querySelector('.cc-mydata__connection-picker input[type=checkbox]').checked = true;
    await f.confirm();
    expect(f.callSkill).toHaveBeenCalledTimes(1);
    expect(f.callSkill.mock.calls[0].slice(0, 2)).toEqual(['household', 'grantSurface']);
    expect(f.callSkill.mock.calls[0][2]).toMatchObject({ viewPubKey: 'SCREEN', nonce: 'n3', ops: ['household.listOpenTasks'] });
  });
});
