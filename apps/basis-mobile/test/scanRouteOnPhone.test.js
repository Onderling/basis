import { describe, it, expect } from 'vitest';
import { encodeEnrollOffer, enrollOfferLink } from '../../basis/src/v2/enrollOffer.js';
import { routeScan } from '../../basis/src/v2/scanRoute.js';   // the one router the phone's scanner calls


describe('the phone\'s scanner, through the one router', () => {
  it('classifies a onderling-contact:// URL as kind:contact', () => {
    const r = routeScan('onderling-contact://eyJ3ZWJpZCI6Imh0dHBzOi8vYS5leGFtcGxlIn0');
    expect(r.kind).toBe('contact');
    expect(r.payload).toMatch(/^onderling-contact:\/\//);
  });

  it('classifies the contact LINK the web app shares (…#contact=<card>) as kind:contact — the card itself (2026-09-19)', () => {
    // Mij → "Mijn contact delen" hands out a link beside the QR; tapped on a phone it must add the contact
    // exactly as the scanned code does — one decoder (`contactCardFromLink`), shared with web's boot.
    const r = routeScan('https://onderling.org/basis/#contact=eyJ3ZWJpZCI6Imh0dHBzOi8vYS5leGFtcGxlIn0');
    expect(r.kind).toBe('contact');
    expect(r.payload).toBe('onderling-contact://eyJ3ZWJpZCI6Imh0dHBzOi8vYS5leGFtcGxlIn0');
    expect(routeScan('https://onderling.org/basis/#enroll=abc').kind).not.toBe('contact');
  });

  it('classifies a onderling-invite:// URL as kind:invite', () => {
    const r = routeScan('onderling-invite://eyJncm91cElkIjoidGVzdCJ9');
    expect(r.kind).toBe('invite');
    expect(r.payload).toMatch(/^onderling-invite:\/\//);
  });

  it('classifies a ?invite= query URL as kind:invite', () => {
    const r = routeScan('https://example/onboard?invite=%7B%22groupId%22%3A%22x%22%7D');
    expect(r.kind).toBe('invite');
  });

  it('classifies the app’s OWN deep link (?join=…&relay=…) and hands back the invite + its relay', () => {
    // 2026-09-08: the hosted app's invite QR is `…?join=<enc>&relay=<ws url>`. The scanner matched
    // `?invite=` only, so scanning the app's own QR with the app did nothing at all.
    const r = routeScan('https://onderling.org/basis/?join=onderling-invite%3A%2F%2Fabc&relay=wss%3A%2F%2Frelay.test');
    expect(r.kind).toBe('invite');
    expect(r.payload).toEqual({ inviteUri: 'onderling-invite://abc', relayUrl: 'wss://relay.test' });
  });

  it('a scheme URI still comes back as the bare string the wizard has always decoded', () => {
    expect(routeScan('onderling-invite://eyJ4IjoxfQ').payload).toBe('onderling-invite://eyJ4IjoxfQ');
  });

  it('returns kind:unknown for an unrelated string', () => {
    const r = routeScan('https://example.com/random');
    expect(r.kind).toBe('unknown');
  });

  it('classifies an onderling-pair:// URL as kind:pair', () => {
    const r = routeScan('onderling-pair://abc123?name=Phone');
    expect(r.kind).toBe('pair');
    expect(r.payload).toMatch(/^onderling-pair:\/\//);
  });

  it('still classifies the LEGACY onderling-pair:// spelling (old QRs keep working; never minted)', () => {
    const r = routeScan('onderling-pair://abc123?name=Phone');
    expect(r.kind).toBe('pair');
  });

  it('returns kind:unknown for empty input', () => {
    expect(routeScan('').kind).toBe('unknown');
  });

  // Adding a device of your OWN — until 2026-09-09 both carriers fell to 'unknown' here, so a scanned
  // code and a tapped link did nothing at all while pasting the same string worked. Same shape as the
  // invite-link bug this file already records, on the flow the second device depends on.
  describe('an offer to add another device of your own', () => {
    const OFFER = encodeEnrollOffer({ relays: ['wss://relay.example'], circles: [{ id: 'c1', handle: 'anna', address: 'addr-1' }] });

    it('classifies the scanned CODE as kind:enroll and hands back the offer URI', () => {
      const r = routeScan(OFFER);
      expect(r.kind).toBe('enroll');
      expect(r.payload).toBe(OFFER);
    });

    it('classifies the clickable LINK form the same way — one payload, two carriers', () => {
      const { link } = enrollOfferLink('https://onderling.org/basis', OFFER);
      const r = routeScan(link);
      expect(r.kind).toBe('enroll');
      expect(r.payload, 'the link must resolve to the same offer the code carries').toBe(OFFER);
    });

    it('does not swallow a circle invite, which is a different act entirely', () => {
      expect(routeScan('onderling-invite://eyJ4IjoxfQ').kind).toBe('invite');
    });

    it('refuses a malformed offer rather than classifying it', () => {
      expect(routeScan('onderling-enroll://not-base64url-at-all!!').kind).toBe('unknown');
    });
  });
});
