/**
 * The clickable form of a contact card (Frits 2026-09-19: "it is supposed to simply link to the website, including
 * the contact"). The card rides the URL's FRAGMENT — `…#contact=<payload>` — as the enrol offer does: a fragment
 * never reaches the server, so the card is in no access log. One decoder takes anything a person may paste: the full
 * link, a bare hash, the raw `onderling-contact://` code.
 */
import { describe, it, expect } from 'vitest';
import { contactCardLink, contactCardFromLink, CONTACT_LINK_PARAM } from '../../src/v2/contactCardLink.js';

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
