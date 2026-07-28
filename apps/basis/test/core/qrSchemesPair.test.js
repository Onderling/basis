/**
 * OBJ-2 device/agent pairing QR payload — makePairUri / parsePairUri round-trip + tolerance.
 */
import { describe, it, expect } from 'vitest';
import { makePairUri, parsePairUri, isQrUri, QR_PAIR_SCHEME } from '../../src/core/qrSchemes.js';

describe('pairing QR payload', () => {
  it('round-trips an address (and is recognised as a QR URI)', () => {
    const uri = makePairUri('nkn-abc123def456');
    expect(uri.startsWith(QR_PAIR_SCHEME)).toBe(true);
    expect(isQrUri(uri)).toBe(true);
    expect(parsePairUri(uri)).toEqual({ addr: 'nkn-abc123def456', name: null });
  });

  it('carries an optional human label', () => {
    const uri = makePairUri('addr-1', 'Frits’ phone');
    expect(parsePairUri(uri)).toEqual({ addr: 'addr-1', name: 'Frits’ phone' });
  });

  it('encodes/decodes addresses with URL-unsafe characters', () => {
    const addr = 'a/b+c=d e';
    expect(parsePairUri(makePairUri(addr))?.addr).toBe(addr);
  });

  it('accepts a bare address (pasted directly, no scheme)', () => {
    expect(parsePairUri('just-an-address')).toEqual({ addr: 'just-an-address', name: null });
  });

  it('rejects another QR scheme and empties', () => {
    expect(parsePairUri('stoop-contact://xyz')).toBeNull();
    expect(parsePairUri('')).toBeNull();
    expect(makePairUri('')).toBe('');
  });

  // Naming decision 2026-07-28 — no new "onderling" identifiers: new QRs mint onderling-pair://, and the
  // legacy spelling stays PARSE-ONLY so a printed/screenshotted pairing QR keeps working.
  it('mints onderling-pair:// and still parses the legacy onderling-pair:// spelling', () => {
    expect(makePairUri('abc')).toMatch(/^onderling-pair:\/\//);
    expect(parsePairUri('onderling-pair://abc?name=Phone')).toEqual({ addr: 'abc', name: 'Phone' });
  });
});
