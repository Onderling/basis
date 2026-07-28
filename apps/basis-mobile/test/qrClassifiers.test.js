import { describe, it, expect } from 'vitest';
import { classifyQrPayload } from '@onderling/react-native/qr';
import { getBasisClassifiers } from '../src/core/qrClassifiers.js';

const CL = getBasisClassifiers();

describe('basis-mobile QR classifiers', () => {
  it('classifies a stoop-contact:// URL as kind:contact', () => {
    const r = classifyQrPayload('stoop-contact://eyJ3ZWJpZCI6Imh0dHBzOi8vYS5leGFtcGxlIn0', CL);
    expect(r.kind).toBe('contact');
    expect(r.payload).toMatch(/^stoop-contact:\/\//);
  });

  it('classifies a stoop-invite:// URL as kind:invite', () => {
    const r = classifyQrPayload('stoop-invite://eyJncm91cElkIjoidGVzdCJ9', CL);
    expect(r.kind).toBe('invite');
    expect(r.payload).toMatch(/^stoop-invite:\/\//);
  });

  it('classifies a ?invite= query URL as kind:invite', () => {
    const r = classifyQrPayload('https://example/onboard?invite=%7B%22groupId%22%3A%22x%22%7D', CL);
    expect(r.kind).toBe('invite');
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

  it('still classifies the LEGACY canopy-pair:// spelling (old QRs keep working; never minted)', () => {
    const r = classifyQrPayload('canopy-pair://abc123?name=Phone', CL);
    expect(r.kind).toBe('pair');
  });

  it('returns kind:unknown for empty input', () => {
    expect(classifyQrPayload('', CL).kind).toBe('unknown');
  });
});
