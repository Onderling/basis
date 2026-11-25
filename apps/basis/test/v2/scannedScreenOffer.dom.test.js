/**
 * A SCREEN'S CONNECT CODE SCANNED ON ME opens 'connect a screen' with the offer in it. @vitest-environment happy-dom
 * The scan router sends it to the screen pairing (a view: its start has no op); the web renderer puts the offer in the
 * field and reads it as if typed, so the three codes show and the person still picks the one the screen shows. Nothing
 * is granted by the scan itself.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { createAppScreenPairing } from '../../src/v2/appScreenPairing.js';
import { encodePairingOffer } from '../../src/v2/connectionPairing.js';
import { routeScan } from '../../src/v2/scanRoute.js';

const t = (k) => k;

describe('a scanned screen offer', () => {
  it('lands in the pairing field and asks for the code; nothing is granted', async () => {
    const offer = encodePairingOffer({ viewPubKey: 'SCREEN', nonce: 'n9', label: 'keuken' });
    const r = routeScan(offer);
    expect(r.target).toMatchObject({ kind: 'view', id: 'screenPairing' });
    const callSkill = vi.fn(async () => ({ ok: true }));
    const pairing = createAppScreenPairing({ callSkill, rand: () => 0.3 });
    const root = document.createElement('div');
    renderCircleMyData(root, {
      t, only: ['connection-add'], screenOffer: r.needs.offer,
      connectionChoices: { ops: [{ id: 'household.listOpenTasks', label: 'taken' }], sections: [] },
      screenPairing: pairing, onPaired: vi.fn(),
    });
    expect(root.querySelector('.cc-mydata__connection-offer').value).toBe(offer);
    await vi.waitFor(() => { if (root.querySelectorAll('.cc-mydata__connection-code').length === 0) throw new Error('no codes yet'); }, { timeout: 5_000, interval: 5 });
    expect(root.querySelectorAll('.cc-mydata__connection-code').length).toBe(3);
    expect(callSkill).not.toHaveBeenCalled();
  });
});
