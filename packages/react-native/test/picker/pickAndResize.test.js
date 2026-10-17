/**
 * pickAndResize — substrate-level coverage. Mirrors the shape of
 * apps/pinboard-mobile/test/imagePicker.test.js (which now exercises
 * the same code through the re-export shim).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pickAndResize,
  captureWithCamera,
  pickFromLibrary,
} from '../../src/picker/pickAndResize.js';

const TEST_PRESET = Object.freeze({
  maxEdgePx:    1280,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

function makeStubModules() {
  const ImagePicker = {
    MediaTypeOptions: { Images: 'Images' },
    requestCameraPermissionsAsync:       vi.fn(async () => ({ granted: true })),
    requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
    launchCameraAsync: vi.fn(async () => ({
      canceled: false,
      assets: [{ uri: 'file:///mock-camera.jpg', width: 4000, height: 3000 }],
    })),
    launchImageLibraryAsync: vi.fn(async () => ({
      canceled: false,
      assets: [
        { uri: 'file:///mock-1.jpg', width: 4000, height: 3000 },
        { uri: 'file:///mock-2.jpg', width: 1024, height: 768 },
      ],
    })),
  };
  const manipulateAsync = vi.fn(async (uri, actions) => {
    const dim = actions[0]?.resize ?? { width: 100, height: 100 };
    return { uri, width: dim.width, height: dim.height, base64: 'A'.repeat(dim.width * 4) };
  });
  const SaveFormat = { JPEG: 'jpeg' };
  return { ImagePicker, manipulateAsync, SaveFormat };
}

describe('pickAndResize — input validation', () => {
  it('throws when preset is missing', async () => {
    await expect(pickAndResize({ mode: 'camera' })).rejects.toThrow(/preset required/);
  });
  it('returns [] for an unknown mode', async () => {
    expect(await pickAndResize({ mode: 'whatever', preset: TEST_PRESET })).toEqual([]);
  });
});

describe('pickAndResize — camera mode', () => {
  let modules;
  beforeEach(() => { modules = makeStubModules(); });

  it('returns one PickedImage with the full shape', async () => {
    const out = await pickAndResize({ mode: 'camera', preset: TEST_PRESET, _modules: modules });
    expect(out).toHaveLength(1);
    const r = out[0];
    expect(r.mime).toBe('image/jpeg');
    expect(r.dataB64).toBeTruthy();
    expect(r.thumbnail).toMatch(/^data:image\/jpeg;base64,/);
    expect(r.bytes).toBeGreaterThan(0);
  });

  it('throws PERMISSION_DENIED when camera permission rejected', async () => {
    modules.ImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    await expect(captureWithCamera(TEST_PRESET, { _modules: modules }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('returns [] when the user cancels', async () => {
    modules.ImagePicker.launchCameraAsync.mockResolvedValueOnce({ canceled: true, assets: [] });
    expect(await pickAndResize({ mode: 'camera', preset: TEST_PRESET, _modules: modules })).toEqual([]);
  });
});

describe('pickAndResize — library mode', () => {
  let modules;
  beforeEach(() => { modules = makeStubModules(); });

  it('returns up to max images', async () => {
    const out = await pickAndResize({ mode: 'library', preset: TEST_PRESET, max: 4, _modules: modules });
    expect(out).toHaveLength(2);
  });

  it('clamps to max', async () => {
    modules.ImagePicker.launchImageLibraryAsync.mockResolvedValueOnce({
      canceled: false,
      assets: Array.from({ length: 5 }, (_, i) => ({
        uri: `file:///${i}.jpg`, width: 1000, height: 1000,
      })),
    });
    const out = await pickFromLibrary(TEST_PRESET, 3, { _modules: modules });
    expect(out).toHaveLength(3);
  });
});

describe('output shape parity with web imageResize.js', () => {
  it('full image is bigger than thumbnail (different b64 lengths)', async () => {
    const modules = makeStubModules();
    const out = await pickAndResize({ mode: 'camera', preset: TEST_PRESET, _modules: modules });
    expect(out[0].dataB64.length).toBeGreaterThan(out[0].thumbnail.length);
  });
});
