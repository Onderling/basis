/**
 * S5 — image attachment encoder. @vitest-environment happy-dom
 *
 * Pure geometry (fit / data-url parsing / mime choice) is tested directly; the
 * Canvas round-trip is verified with INJECTED fakes so we assert the RESULT —
 * the {mime, dataB64, width, height, thumbnail} record matches the shape
 * pinboard.validateInboundAttachment accepts — without a real browser canvas.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  fitDimensions, dataUrlToB64, outputMimeFor, encodeImageFile,
} from '../src/v2/attachmentEncoder.js';

describe('fitDimensions', () => {
  it('passes through when within the box', () => {
    expect(fitDimensions(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
  it('scales down the longest edge, preserving aspect ratio', () => {
    expect(fitDimensions(2560, 1440, 1280)).toEqual({ width: 1280, height: 720 });
  });
  it('handles portrait + degenerate input', () => {
    expect(fitDimensions(1000, 4000, 1280)).toEqual({ width: 320, height: 1280 });
    expect(fitDimensions(0, 100, 1280)).toEqual({ width: 0, height: 0 });
  });
});

describe('dataUrlToB64 / outputMimeFor', () => {
  it('strips the data-url prefix', () => {
    expect(dataUrlToB64('data:image/jpeg;base64,QUJD')).toBe('QUJD');
    expect(dataUrlToB64('QUJD')).toBe('QUJD');
  });
  it('keeps png/webp, folds everything else to jpeg', () => {
    expect(outputMimeFor('image/png')).toBe('image/png');
    expect(outputMimeFor('image/webp')).toBe('image/webp');
    expect(outputMimeFor('image/jpeg')).toBe('image/jpeg');
    expect(outputMimeFor('image/gif')).toBe('image/jpeg');
  });
});

describe('encodeImageFile (injected canvas)', () => {
  const fakeCanvas = (label) => ({
    width: 0, height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toDataURL: (mime) => `data:${mime};base64,${label}`,
  });

  it('produces the inbound-attachment shape from a picked File', async () => {
    const loadImage = vi.fn(async () => ({ drawable: {}, width: 2000, height: 1000 }));
    let n = 0;
    const makeCanvas = vi.fn(() => fakeCanvas(n++ === 0 ? 'FULLDATA' : 'THUMBDATA'));

    const out = await encodeImageFile({ type: 'image/jpeg', name: 'p.jpg' }, { loadImage, makeCanvas });

    expect(out.mime).toBe('image/jpeg');
    expect(out.width).toBe(1280);   // 2000→1280 longest edge
    expect(out.height).toBe(640);
    expect(out.dataB64).toBe('FULLDATA');
    expect(out.thumbnail).toBe('data:image/jpeg;base64,THUMBDATA');
    // thumbnail canvas sized to ~120px longest edge
    const thumbCall = makeCanvas.mock.calls[1];
    expect(Math.max(thumbCall[0], thumbCall[1])).toBe(120);
  });

  it('rejects a disallowed mime', async () => {
    await expect(encodeImageFile({ type: 'image/gif' }, { loadImage: async () => ({ drawable: {}, width: 10, height: 10 }) }))
      .rejects.toThrow(/mime-not-allowed/);
  });

  it('returns null for a non-File input', async () => {
    expect(await encodeImageFile(null)).toBeNull();
  });
});
