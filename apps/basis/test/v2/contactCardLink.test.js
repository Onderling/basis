/**
 * The clickable form of a contact card (Frits 2026-09-19: "it is supposed to simply link to the website, including
 * the contact"). The card rides the URL's FRAGMENT — `…#contact=<payload>` — as the enrol offer does: a fragment
 * never reaches the server, so the card is in no access log. One decoder takes anything a person may paste: the full
 * link, a bare hash, the raw `onderling-contact://` code.
 */
import { describe, it, expect } from 'vitest';
import { contactCardLink, contactCardFromLink, loadShareMyContact, decodeContactCard, cardNamesSender, CONTACT_LINK_PARAM, SHARED_LINK_TOKEN_PARAM, sharedLinkState, sharedLinkWords, withdrawSharedLink } from '../../src/v2/contactCardLink.js';
import { encodeContactCard } from '@onderling-app/pinboard/lib/contactCard';

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
    const callSkill = async (app, op) => (app === 'pinboard' && op === 'getContactShareQr' ? { payload: CARD } : {});
    const LINK = `https://onderling.org/basis/#${CONTACT_LINK_PARAM}=eyJ3ZWJpZCI6Ind4In0`;
    // the QR is the LINK when there is one — a camera opens it; the in-app scanner reads it too (2026-09-21)
    expect(await loadShareMyContact({ callSkill, appUrl: 'https://onderling.org/basis/' })).toEqual({ payload: CARD, link: LINK, qr: LINK, qrEncodes: 'link', token: null });
    // …and the raw code without an app url — only the in-app scanner reads that
    expect(await loadShareMyContact({ callSkill })).toEqual({ payload: CARD, link: null, qr: CARD, qrEncodes: 'code', token: null });
    expect(await loadShareMyContact({ callSkill: async () => ({ error: 'no identity' }) })).toEqual({ payload: null, link: null, qr: null, qrEncodes: null, token: null });
    expect(await loadShareMyContact({ callSkill: async () => { throw new Error('down'); } })).toEqual({ payload: null, link: null, qr: null, qrEncodes: null, token: null });
  });
});

describe('a shared link carries a one-time token beside the card (L806: its first opener is let on)', () => {
  const TOKEN = 'AAAAAAAAAAAAAAAAAAAAAA';
  it('the token rides the fragment after the card, and comes back out of a link; a link without one gives none', () => {
    const r = contactCardLink('https://onderling.org/basis/', CARD, TOKEN);
    expect(r).toEqual({ ok: true, link: `https://onderling.org/basis/#${CONTACT_LINK_PARAM}=eyJ3ZWJpZCI6Ind4In0&${SHARED_LINK_TOKEN_PARAM}=${TOKEN}` });
    expect(contactCardFromLink(r.link)).toEqual({ ok: true, payload: CARD, token: TOKEN });
    expect(contactCardFromLink(`#${SHARED_LINK_TOKEN_PARAM}=${TOKEN}&contact=eyJ3ZWJpZCI6Ind4In0`)).toEqual({ ok: true, payload: CARD, token: TOKEN });
    // a token that is not base64url is dropped (the card still stands); the raw code carries none
    expect(contactCardFromLink('#contact=eyJ3ZWJpZCI6Ind4In0&t=bad*token')).toEqual({ ok: true, payload: CARD });
    expect(contactCardFromLink(CARD)).toEqual({ ok: true, payload: CARD });
  });
  it('the panel mints a NEW token for every showing and puts it in the link only (the code is the bare card)', async () => {
    let n = 0;
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push([app, op, args]);
      if (op === 'getContactShareQr') return { payload: CARD };
      if (op === 'mintSharedCard') return { token: `tok${(n += 1)}AAAAAAAAAAAAAAAAAAA`, expiresAt: 1 };
      return {};
    };
    const a = await loadShareMyContact({ callSkill, appUrl: 'https://onderling.org/basis/' });
    const b = await loadShareMyContact({ callSkill, appUrl: 'https://onderling.org/basis/' });
    expect(a.token).toBe('tok1AAAAAAAAAAAAAAAAAAA');
    expect(b.token).toBe('tok2AAAAAAAAAAAAAAAAAAA');
    expect(contactCardFromLink(a.link).token).toBe(a.token);
    expect(a.qr).toBe(a.link);
    expect(a.payload).toBe(CARD);
    // without a link nothing is minted: a token nobody can carry would only use up the bound
    const c = await loadShareMyContact({ callSkill });
    expect(c.token).toBeNull();
    expect(calls.filter(([, op]) => op === 'mintSharedCard')).toHaveLength(2);
  });
  it('a mint that fails leaves the link as it was (its opener is then a request, as before)', async () => {
    const callSkill = async (app, op) => (op === 'getContactShareQr' ? { payload: CARD } : { error: 'no-contacts' });
    const r = await loadShareMyContact({ callSkill, appUrl: 'https://onderling.org/basis/' });
    expect(r).toMatchObject({ payload: CARD, token: null, link: `https://onderling.org/basis/#${CONTACT_LINK_PARAM}=eyJ3ZWJpZCI6Ind4In0` });
  });
});

describe('the shared link\'s state, as the panel says it (both shells)', () => {
  const TOKEN = 'BBBBBBBBBBBBBBBBBBBBBB';
  const listing = (links) => async (app, op) => (op === 'listSharedCards' ? { links } : {});
  const t = (k, v) => (v?.date ? `${k}:${v.date}` : k);
  it('not used yet, used (on which day), or gone; and the words for it', async () => {
    expect(await sharedLinkState({ callSkill: listing([{ token: TOKEN, state: 'unused', usedAt: null }]), token: TOKEN })).toEqual({ state: 'unused', usedAt: null });
    const used = await sharedLinkState({ callSkill: listing([{ token: TOKEN, state: 'used', usedAt: Date.UTC(2026, 10, 14, 12) }]), token: TOKEN });
    expect(used).toEqual({ state: 'used', usedAt: Date.UTC(2026, 10, 14, 12) });
    expect(await sharedLinkState({ callSkill: listing([]), token: TOKEN })).toEqual({ state: 'gone', usedAt: null });
    expect(await sharedLinkState({ callSkill: listing([]), token: null })).toEqual({ state: 'gone', usedAt: null });
    expect(sharedLinkWords({ state: 'unused' }, { t })).toBe('circle.shareContact.link_unused');
    expect(sharedLinkWords(used, { t, lang: 'en', tz: 'UTC' })).toBe('circle.shareContact.link_used:14 Nov');
    expect(sharedLinkWords(used, { t, lang: 'nl', tz: 'UTC' })).toBe('circle.shareContact.link_used:14 nov');
    expect(sharedLinkWords({ state: 'gone' }, { t })).toBeNull();
  });
  it('withdraw asks pinboard to drop exactly that link', async () => {
    const calls = [];
    const callSkill = async (app, op, args) => { calls.push([app, op, args]); return { withdrawn: true }; };
    expect(await withdrawSharedLink({ callSkill, token: TOKEN })).toBe(true);
    expect(calls).toEqual([['pinboard', 'withdrawSharedCard', { token: TOKEN }]]);
    expect(await withdrawSharedLink({ callSkill, token: null })).toBe(false);
  });
});

describe('a card that rides a message is taken only when it names the sender (2026-09-21)', () => {
  const encode = (obj) => 'onderling-contact://' + encodeContactCard(obj);
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

describe('a shared link scanned in the app, or opened as a deep link, keeps its token through the shared add (L806)', () => {
  it('the scanner keeps the whole link when it carries a token; the add splits it into the card and the token', async () => {
    const { routeScan } = await import('../../src/v2/scanRoute.js');
    const { addContactAs, contactAddSheetModel } = await import('../../src/v2/contactLens.js');
    const TOKEN = 'CCCCCCCCCCCCCCCCCCCCCC';
    const CARD = 'onderling-contact://' + encodeContactCard({ webid: 'wx', pubKey: 'wx', displayName: 'W' });
    const link = contactCardLink('https://onderling.org/basis/', CARD, TOKEN).link;
    const r = routeScan(link);
    expect(r.kind).toBe('contact');
    expect(r.needs.payload).toBe(link);
    // a link without a token is read as its card, as before
    expect(routeScan(contactCardLink('https://onderling.org/basis/', CARD).link).needs.payload).toBe(CARD);
    const calls = [];
    const callSkill = async (app, op, args) => { calls.push([op, args]); return op === 'addContactFromQr' ? { contact: { webid: 'wx' } } : {}; };
    await addContactAs({ callSkill, payload: link });
    expect(calls.find(([op]) => op === 'addContactFromQr')[1]).toMatchObject({ payload: CARD, linkToken: TOKEN });
    expect((await contactAddSheetModel({ payload: link, callSkill }))?.payload).toBe(CARD);
  });
});

describe('Contacten names the first opener of my shared link from the card their turn carried (L806)', () => {
  it('an unnamed row takes the name; a named row keeps its own; other rows are untouched', async () => {
    const { nameLinkOpeners } = await import('../../src/v2/contactsSource.js');
    const rows = [{ contactId: 'bobkey', name: 'bobkey' }, { contactId: 'carolkey', name: 'Carol' }, { contactId: 'dave', name: 'dave' }];
    const links = async () => [
      { state: 'used', usedBy: 'bobkey', usedByName: 'Bea' },
      { state: 'used', usedBy: 'carolkey', usedByName: 'Someone else' },
      { state: 'unused', usedBy: null, usedByName: null },
    ];
    expect((await nameLinkOpeners(rows, { links })).map((r) => r.name)).toEqual(['Bea', 'Carol', 'dave']);
  });
});

describe('the link lookup runs only when Contacten has a row without a name (L806)', () => {
  it('every row named: no read of the links', async () => {
    const { nameLinkOpeners } = await import('../../src/v2/contactsSource.js');
    let reads = 0;
    const links = async () => { reads += 1; return []; };
    await nameLinkOpeners([{ contactId: 'a', name: 'Anna' }], { links });
    expect(reads).toBe(0);
    await nameLinkOpeners([{ contactId: 'a', name: 'a' }], { links });
    expect(reads).toBe(1);
  });
});
