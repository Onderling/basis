/**
 * THE ONE SCANNER ROUTES EVERY CODE BASIS MAKES (Frits 2026-11-20, three rules):
 *   (i)   a code is routed the same way as the others: a classifier and a declared target in the one table;
 *   (ii)  every scheme Basis makes is either routed or named as deliberately not (the guard reads `SCAN_SCHEMES`);
 *   (iii) a scanner CALLED FOR ONE PURPOSE routes only that kind, and says so in words for anything else.
 * A screen's connect code opens the screen pairing with the offer in it (a view: its start has no op, its grant at the
 * end is `grantSurface`). A bot-link offer is what the app makes for the bot's chat: the scanner says where it goes.
 */
import { describe, it, expect } from 'vitest';
import { routeScan, SCAN_CLASSIFIERS, SCAN_TARGETS, SCAN_SCHEMES, scanSayKey } from '../../src/v2/scanRoute.js';
import { QR_URI_PREFIXES } from '../../src/core/qrSchemes.js';
import { CONNECT_SCHEME } from '../../src/v2/connectionPairing.js';
import { LINK_OFFER_SCHEME } from '../../src/v2/identityLink.js';

const CONNECT = `${CONNECT_SCHEME}eyJ2IjoxfQ`;
const KOPPEL = `${LINK_OFFER_SCHEME}eyJ2IjoxfQ`;

describe('a screen\'s connect code and a bot-link offer, routed by the one table', () => {
  it('a connect code opens the screen pairing, the offer in it', () => {
    expect(routeScan(CONNECT)).toMatchObject({ kind: 'screen', payload: CONNECT, target: { kind: 'view', id: 'screenPairing' }, needs: { offer: CONNECT } });
  });

  it('a bot-link offer is deliberately not routed: it is said where it goes, never "unknown"', () => {
    const r = routeScan(KOPPEL);
    expect(r).toMatchObject({ kind: 'botlink', target: { kind: 'not' } });
    expect(scanSayKey(r)).toBe('circle.scan.botlink_for_chat');
  });

  it('the classifier list and the target table hold the same kinds', () => {
    expect(Object.keys(SCAN_TARGETS).sort()).toEqual(SCAN_CLASSIFIERS.map((c) => c.kind).sort());
    expect(SCAN_CLASSIFIERS.map((c) => c.kind)).toEqual(['contact', 'invite', 'pair', 'enroll', 'claim', 'screen', 'botlink']);
  });
});

describe('a scanner called for one purpose', () => {
  it('routes the kind it was called for', () => {
    expect(routeScan(CONNECT, { for: 'screen' })).toMatchObject({ kind: 'screen', target: { id: 'screenPairing' } });
  });
  it('refuses any other kind in words, and hands no target on', () => {
    const r = routeScan('onderling-contact://AYEgabc', { for: 'screen' });
    expect(r.target).toBeUndefined();
    expect(r).toMatchObject({ kind: 'contact', refused: 'not-for-here', for: 'screen' });
    expect(scanSayKey(r)).toBe('circle.scan.not_for_here');
  });
  it('an unreadable text there is said as unknown', () => {
    expect(scanSayKey(routeScan('hello', { for: 'screen' }))).toBe('scan_qr.scan_unknown');
  });
});

describe('every scheme Basis makes is in the one scheme table', () => {
  it('each scheme names a routed kind, or why it is not routed', () => {
    for (const [scheme, kind] of Object.entries(SCAN_SCHEMES)) {
      if (kind.startsWith('not:')) expect(kind.length, scheme).toBeGreaterThan(12);
      else expect(SCAN_TARGETS[kind], `${scheme} → ${kind}`).toBeTruthy();
    }
  });
  it('the prefixes the renderers and the app links know are all in it (two lists, one fact)', () => {
    for (const p of QR_URI_PREFIXES) expect(SCAN_SCHEMES[p], p).toBeTruthy();
    expect(SCAN_SCHEMES[CONNECT_SCHEME]).toBe('screen');
    expect(SCAN_SCHEMES[LINK_OFFER_SCHEME]).toBe('botlink');
  });
});
