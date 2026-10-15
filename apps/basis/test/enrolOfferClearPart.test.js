/**
 * THE ENROL OFFER'S CLEAR PART tells nothing about personas. It is public by design (shown as a QR code, sent as a link),
 * so the personas and their circles ride sealed to the phrase — and the sealed part is padded, so its length does not
 * say whether there are personas, how many, or how many circles they are in.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap } from '@onderling/core';
import { encodeEnrollOffer, parseEnrollOffer, sealOfferPersonas, openOfferPersonas, offerWithPersonaCircles } from '../src/v2/enrollOffer.js';

const { bootstrap: root, mnemonic: PHRASE } = Bootstrap.create();
const personas = [
  { id: 'p-0123456789ab', name: 'Werk', circles: [{ id: 'werk-circle', handle: 'ann', address: 'addr-werk-1' }, { id: 'werk-2', address: 'addr-werk-2' }] },
  { id: 'p-ba9876543210', name: 'Buurt', circles: [{ id: 'buurt-circle', address: 'addr-buurt-1' }] },
];
const clearBody = (uri) => JSON.stringify({ ...parseEnrollOffer(uri), personasSealed: undefined });

describe('the enrol offer\'s clear part', () => {
  it('the sealed part has the same length with no personas and with several (padded)', () => {
    expect(sealOfferPersonas(root, []).length).toBe(sealOfferPersonas(root, personas).length);
  });

  it('names no persona, no persona\'s circle and no address of one in the clear', () => {
    const uri = encodeEnrollOffer({ circles: [{ id: 'thuis', address: 'addr-thuis' }], personasSealed: sealOfferPersonas(root, personas) });
    const clear = clearBody(uri);
    for (const needle of ['p-0123456789ab', 'p-ba9876543210', 'Werk', 'Buurt', 'werk-circle', 'buurt-circle', 'addr-werk-1', 'addr-buurt-1']) {
      expect(clear.includes(needle), needle).toBe(false);
    }
    expect(clear.includes('thuis')).toBe(true);
  });

  it('an offer may be sealed-only (all circles under personas); the phrase opens it, with each persona\'s circles', () => {
    const uri = encodeEnrollOffer({ circles: [], personasSealed: sealOfferPersonas(root, personas) });
    const parsed = parseEnrollOffer(uri);
    expect(parsed.ok).toBe(true);
    expect(parsed.circles).toEqual([]);
    const opened = openOfferPersonas(uri, PHRASE);
    expect(opened.map((p) => p.id)).toEqual(['p-0123456789ab', 'p-ba9876543210']);
    expect(opened[0].circles.map((c) => c.id)).toEqual(['werk-circle', 'werk-2']);
    // another phrase opens nothing
    expect(openOfferPersonas(uri, Bootstrap.create().mnemonic)).toEqual([]);
  });

  it('the new device\'s own stash: the PICKED personas\' circles, tagged with their persona, and no other', () => {
    const uri = encodeEnrollOffer({ circles: [{ id: 'thuis', address: 'addr-thuis' }], personasSealed: sealOfferPersonas(root, personas) });
    const widened = parseEnrollOffer(offerWithPersonaCircles(uri, PHRASE, ['p-0123456789ab']));
    expect(widened.circles.map((c) => [c.id, c.persona ?? null])).toEqual([['thuis', null], ['werk-circle', 'p-0123456789ab'], ['werk-2', 'p-0123456789ab']]);
    expect(offerWithPersonaCircles(uri, PHRASE, []), 'nothing picked: nothing to add').toBe(null);
  });
});
