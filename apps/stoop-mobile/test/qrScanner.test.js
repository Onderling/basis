/**
 * qrScanner tests — payload classifier.  Pure JS, no Expo / camera
 * deps.
 */

import { describe, it, expect } from 'vitest';
import { classifyQrPayload, _internal } from '../src/lib/qrScanner.js';

describe('classifyQrPayload — invite', () => {
  const validInvite = {
    groupId:   'oosterpoort',
    nonce:     'abc123',
    expiresAt: 1234567890,
    role:      'member',
    signature: 'sig-base64url',
  };

  it('decodes a Stoop-web onboard URL with ?invite=<encoded-json>', () => {
    const url = `https://stoop.example/onboard.html?invite=${encodeURIComponent(JSON.stringify(validInvite))}`;
    const r = classifyQrPayload(url);
    expect(r.kind).toBe('invite');
    expect(r.payload.groupId).toBe('oosterpoort');
    expect(r.payload.signature).toBe('sig-base64url');
  });

  it('decodes bare JSON', () => {
    const r = classifyQrPayload(JSON.stringify(validInvite));
    expect(r.kind).toBe('invite');
    expect(r.payload.groupId).toBe('oosterpoort');
  });

  it('rejects URL with ?invite that doesn\'t parse to a valid invite', () => {
    const url = 'https://stoop.example/onboard.html?invite=' + encodeURIComponent(JSON.stringify({ foo: 'bar' }));
    expect(classifyQrPayload(url).kind).toBe('unknown');
  });

  it('rejects JSON without groupId + (signature|code)', () => {
    expect(classifyQrPayload(JSON.stringify({ groupId: 'x' })).kind).toBe('unknown');
    expect(classifyQrPayload(JSON.stringify({ signature: 'x' })).kind).toBe('unknown');
    expect(classifyQrPayload(JSON.stringify({ code: 'x' })).kind).toBe('unknown');
  });

  it('accepts the Stoop membership-code shape — `{groupId, code, expiresAt}`', () => {
    const payload = JSON.stringify({
      groupId:   'oosterpoort',
      code:      'P3LK9-X4QM7',
      expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
    });
    const r = classifyQrPayload(payload);
    expect(r.kind).toBe('invite');
    expect(r.payload.groupId).toBe('oosterpoort');
    expect(r.payload.code).toBe('P3LK9-X4QM7');
  });
});

describe('classifyQrPayload — contact', () => {
  it('recognises onderling-contact:// URIs', () => {
    const r = classifyQrPayload('onderling-contact://anne?webid=https%3A%2F%2Fid.example%2Fanne');
    expect(r.kind).toBe('contact');
    expect(r.payload).toBe('onderling-contact://anne?webid=https%3A%2F%2Fid.example%2Fanne');
  });

  it('handles surrounding whitespace', () => {
    const r = classifyQrPayload('   onderling-contact://x   ');
    expect(r.kind).toBe('contact');
    expect(r.payload).toBe('onderling-contact://x');
  });

  it('rejects other custom schemes', () => {
    expect(classifyQrPayload('folio://share/x').kind).toBe('unknown');
  });
});

describe('classifyQrPayload — recovery phrase', () => {
  const TWELVE_WORDS = 'abandon ability able about above absent absorb abstract absurd abuse access accident';
  const TWENTY_FOUR_WORDS = TWELVE_WORDS + ' abandon ability able about above absent absorb abstract absurd abuse access accident';

  it('classifies a 12-word phrase', () => {
    const r = classifyQrPayload(TWELVE_WORDS);
    expect(r.kind).toBe('recovery');
    expect(r.payload).toHaveLength(12);
    expect(r.payload[0]).toBe('abandon');
  });

  it('classifies a 24-word phrase', () => {
    const r = classifyQrPayload(TWENTY_FOUR_WORDS);
    expect(r.kind).toBe('recovery');
    expect(r.payload).toHaveLength(24);
  });

  it('rejects 13-word strings (not a BIP-39 word count)', () => {
    const r = classifyQrPayload(TWELVE_WORDS + ' extra');
    expect(r.kind).toBe('unknown');
  });

  it('rejects a phrase containing uppercase or digits', () => {
    expect(classifyQrPayload('abandon ABILITY able about above absent absorb abstract absurd abuse access accident').kind).toBe('unknown');
    expect(classifyQrPayload('abandon ability able1 about above absent absorb abstract absurd abuse access accident').kind).toBe('unknown');
  });

  it('rejects a single-word string', () => {
    expect(classifyQrPayload('abandon').kind).toBe('unknown');
  });

  it('handles surrounding whitespace + extra spaces', () => {
    const r = classifyQrPayload('  ' + TWELVE_WORDS.replace(/ /g, '   ') + '  ');
    expect(r.kind).toBe('recovery');
    expect(r.payload).toHaveLength(12);
  });
});

describe('classifyQrPayload — fallthrough', () => {
  it('returns unknown for empty / non-string input', () => {
    expect(classifyQrPayload('').kind).toBe('unknown');
    expect(classifyQrPayload(null).kind).toBe('unknown');
    expect(classifyQrPayload(undefined).kind).toBe('unknown');
    expect(classifyQrPayload(42).kind).toBe('unknown');
  });

  it('returns unknown for plain URLs without ?invite=', () => {
    expect(classifyQrPayload('https://example.com').kind).toBe('unknown');
    expect(classifyQrPayload('http://stoop.example/').kind).toBe('unknown');
  });
});

describe('_internal — exports for test introspection', () => {
  it('exposes the constants', () => {
    expect(_internal.STOOP_CONTACT_SCHEME).toBe('onderling-contact://');
    expect(_internal.BIP39_WORD_COUNTS.has(12)).toBe(true);
    expect(_internal.BIP39_WORD_COUNTS.has(24)).toBe(true);
    expect(_internal.BIP39_WORD_COUNTS.has(13)).toBe(false);
  });
});
