import { describe, it, expect } from 'vitest';
import { classifyQrPayload } from '@onderling/react-native/qr';
import { getBasisClassifiers } from '../src/core/qrClassifiers.js';

const CL = getBasisClassifiers();

describe('basis-mobile QR classifiers', () => {
  it('classifies a onderling-contact:// URL as kind:contact', () => {
    const r = classifyQrPayload('onderling-contact://eyJ3ZWJpZCI6Imh0dHBzOi8vYS5leGFtcGxlIn0', CL);
    expect(r.kind).toBe('contact');
    expect(r.payload).toMatch(/^onderling-contact:\/\//);
  });

  it('classifies a onderling-invite:// URL as kind:invite', () => {
    const r = classifyQrPayload('onderling-invite://eyJncm91cElkIjoidGVzdCJ9', CL);
    expect(r.kind).toBe('invite');
    expect(r.payload).toMatch(/^onderling-invite:\/\//);
  });

  it('classifies a ?invite= query URL as kind:invite', () => {
    const r = classifyQrPayload('https://example/onboard?invite=%7B%22groupId%22%3A%22x%22%7D', CL);
    expect(r.kind).toBe('invite');
  });

  it('classifies the app’s OWN deep link (?join=…&relay=…) and hands back the invite + its relay', () => {
    // 2026-09-08: the hosted app's invite QR is `…?join=<enc>&relay=<ws url>`. The scanner matched
    // `?invite=` only, so scanning the app's own QR with the app did nothing at all.
    const r = classifyQrPayload('https://onderling.org/basis/?join=onderling-invite%3A%2F%2Fabc&relay=wss%3A%2F%2Frelay.onderling.org', CL);
    expect(r.kind).toBe('invite');
    expect(r.payload).toEqual({ inviteUri: 'onderling-invite://abc', relayUrl: 'wss://relay.onderling.org' });
  });

  it('a scheme URI still comes back as the bare string the wizard has always decoded', () => {
    expect(classifyQrPayload('onderling-invite://eyJ4IjoxfQ', CL).payload).toBe('onderling-invite://eyJ4IjoxfQ');
  });

  it('returns kind:unknown for an unrelated string', () => {
    const r = classifyQrPayload('https://example.com/random', CL);
    expect(r.kind).toBe('unknown');
  });

  it('classifies an onderling-pair:// URL as kind:pair', () => {
    const r = classifyQrPayload('onderling-pair://abc123?name=Phone', CL);
    expect(r.kind).toBe('pair');
    expect(r.payload).toMatch(/^onderling-pair:\/\//);
  });

  it('still classifies the LEGACY onderling-pair:// spelling (old QRs keep working; never minted)', () => {
    const r = classifyQrPayload('onderling-pair://abc123?name=Phone', CL);
    expect(r.kind).toBe('pair');
  });

  it('returns kind:unknown for empty input', () => {
    expect(classifyQrPayload('', CL).kind).toBe('unknown');
  });
});
