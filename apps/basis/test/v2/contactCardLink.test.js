/**
 * The clickable form of a contact card (Frits 2026-09-19: "it is supposed to simply link to the website, including
 * the contact"). The card rides the URL's FRAGMENT — `…#contact=<payload>` — as the enrol offer does: a fragment
 * never reaches the server, so the card is in no access log. One decoder takes anything a person may paste: the full
 * link, a bare hash, the raw `onderling-contact://` code.
 */
import { describe, it, expect } from 'vitest';
import { contactCardLink, contactCardFromLink, loadShareMyContact, decodeContactCard, cardNamesSender, CONTACT_LINK_PARAM } from '../../src/v2/contactCardLink.js';

const CARD = 'onderling-contact://eyJ3ZWJpZCI6Ind4In0';

describe('contactCardLink', () => {
  it('puts the card in the fragment of the app URL, scheme stripped', () => {
    const r = contactCardLink('https://onderling.org/basis/', CARD);
    expect(r).toEqual({ ok: true, link: `https://onderling.org/basis/#${CONTACT_LINK_PARAM}=eyJ3ZWJpZCI6Ind4In0` });
    // an app served with a path or a query keeps it; an existing fragment is replaced
    expect(contactCardLink('https://x.org/app/?relay=a#old', CARD).link).toBe('https://x.org/app/?relay=a#contact=eyJ3ZWJpZCI6Ind4In0');
  });
  it('refuses what is not a card or not an http(s) app url', () => {
    expect(contactCardLink('https://onderling.org/basis/', 'onderling-invite://abc').ok).toBe(false);
    expect(contactCardLink('https://onderling.org/basis/', '').ok).toBe(false);
    expect(contactCardLink('ftp://x', CARD).ok).toBe(false);
  });
});

describe('contactCardFromLink', () => {
  it('recovers the card from a full link, a bare hash, or the raw code', () => {
    const link = contactCardLink('https://onderling.org/basis/', CARD).link;
    expect(contactCardFromLink(link)).toEqual({ ok: true, payload: CARD });
    expect(contactCardFromLink('#contact=eyJ3ZWJpZCI6Ind4In0')).toEqual({ ok: true, payload: CARD });
    expect(contactCardFromLink('contact=eyJ3ZWJpZCI6Ind4In0&other=1')).toEqual({ ok: true, payload: CARD });
    expect(contactCardFromLink(`  ${CARD}  `)).toEqual({ ok: true, payload: CARD });
  });
  it('says no to everything else — an enrol link, an empty hash, junk', () => {
    expect(contactCardFromLink('https://onderling.org/basis/#enroll=abc').ok).toBe(false);
    expect(contactCardFromLink('#').ok).toBe(false);
    expect(contactCardFromLink('').ok).toBe(false);
    expect(contactCardFromLink(null).ok).toBe(false);
    expect(contactCardFromLink('#contact=not*base64').ok).toBe(false);
  });
});

describe('loadShareMyContact — what the panel shows, for both shells', () => {
  it('the card and its link; the code alone without an app url; nothing without a card', async () => {
    const callSkill = async (app, op) => (app === 'stoop' && op === 'getContactShareQr' ? { payload: CARD } : {});
    const LINK = `https://onderling.org/basis/#${CONTACT_LINK_PARAM}=eyJ3ZWJpZCI6Ind4In0`;
    // the QR is the LINK when there is one — a camera opens it; the in-app scanner reads it too (2026-09-21)
    expect(await loadShareMyContact({ callSkill, appUrl: 'https://onderling.org/basis/' })).toEqual({ payload: CARD, link: LINK, qr: LINK, qrEncodes: 'link' });
    // …and the raw code without an app url — only the in-app scanner reads that
    expect(await loadShareMyContact({ callSkill })).toEqual({ payload: CARD, link: null, qr: CARD, qrEncodes: 'code' });
    expect(await loadShareMyContact({ callSkill: async () => ({ error: 'no identity' }) })).toEqual({ payload: null, link: null, qr: null, qrEncodes: null });
    expect(await loadShareMyContact({ callSkill: async () => { throw new Error('down'); } })).toEqual({ payload: null, link: null, qr: null, qrEncodes: null });
  });
});

describe('a card that rides a message is taken only when it names the sender (2026-09-21)', () => {
  const encode = (obj) => 'onderling-contact://' + Buffer.from(JSON.stringify(obj)).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const bea = encode({ webid: 'bea-webid', pubKey: 'bea-device-key', displayName: 'Bea', peerAddr: 'bea-webid', relays: ['wss://r'] });
  it('decodes the card, and refuses junk', () => {
    expect(decodeContactCard(bea)).toMatchObject({ webid: 'bea-webid', displayName: 'Bea' });
    expect(decodeContactCard('onderling-contact://not*base64')).toBeNull();
    expect(decodeContactCard('onderling-invite://abc')).toBeNull();
    expect(decodeContactCard(encode({ displayName: 'no webid' }))).toBeNull();
  });
  it('the card is taken when it names the person the message came from — by webid or by the address it says to write to', () => {
    expect(cardNamesSender(bea, 'bea-webid')?.displayName).toBe('Bea');
    const viaAddr = encode({ webid: 'bea-webid', displayName: 'Bea', peerAddr: 'bea-profile-addr' });
    expect(cardNamesSender(viaAddr, 'bea-profile-addr')?.displayName).toBe('Bea');
  });
  it('…and dropped when it names anyone else — a stranger cannot put a name on someone else\'s address', () => {
    expect(cardNamesSender(bea, 'carl-webid')).toBeNull();
    expect(cardNamesSender(bea, '')).toBeNull();
    expect(cardNamesSender('', 'bea-webid')).toBeNull();
  });
});
