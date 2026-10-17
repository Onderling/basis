/**
 * S5 (mobile) — image attachment picker/encoder. Pure shaping + orchestration
 * with INJECTED expo fakes (no native modules needed), mirroring web's
 * attachmentEncoder test. Asserts the RESULT: the {mime,dataB64,width,height,
 * thumbnail} record matches the shape pinboard.validateInboundAttachment accepts.
 */
import { describe, it, expect, vi } from 'vitest';
import { toInboundAttachment, pickAndEncodeImage } from '../src/v2/attachmentPicker.js';

describe('toInboundAttachment', () => {
  it('shapes a manipulator result + thumbnail into the inbound record', () => {
    const out = toInboundAttachment({
      full: { base64: 'FULLB64', width: 1280, height: 720 },
      thumbBase64: 'THUMBB64',
    });
    expect(out).toEqual({
      mime: 'image/jpeg', dataB64: 'FULLB64', width: 1280, height: 720,
      thumbnail: 'data:image/jpeg;base64,THUMBB64',
    });
  });
  it('returns null when the full image has no base64', () => {
    expect(toInboundAttachment({ full: { width: 10, height: 10 }, thumbBase64: 'x' })).toBeNull();
  });
});

function fakeExpo({ canceled = false, width = 2000, height = 1000 } = {}) {
  const manipulateAsync = vi.fn(async (uri, actions) => {
    const isThumb = actions.some((a) => a.resize?.width === 120);
    return isThumb
      ? { uri: 't', width: 120, height: 60, base64: 'THUMB' }
      : { uri: 'f', width: 1280, height: 640, base64: 'FULL' };
  });
  const picker = {
    requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
    launchImageLibraryAsync: vi.fn(async () => (canceled
      ? { canceled: true }
      : { canceled: false, assets: [{ uri: 'file://x.jpg', width, height }] })),
    MediaTypeOptions: { Images: 'Images' },
  };
  const manipulator = { manipulateAsync, SaveFormat: { JPEG: 'jpeg' } };
  return { picker, manipulator };
}

describe('pickAndEncodeImage', () => {
  it('picks, resizes the longest edge + builds a thumbnail → inbound shape', async () => {
    const { picker, manipulator } = fakeExpo({ width: 2000, height: 1000 });
    const out = await pickAndEncodeImage({ picker, manipulator });
    expect(out).toEqual({
      mime: 'image/jpeg', dataB64: 'FULL', width: 1280, height: 640,
      thumbnail: 'data:image/jpeg;base64,THUMB',
    });
    // landscape → resize by width
    expect(manipulator.manipulateAsync.mock.calls[0][1]).toEqual([{ resize: { width: 1280 } }]);
  });

  it('returns null when the user cancels', async () => {
    const { picker, manipulator } = fakeExpo({ canceled: true });
    expect(await pickAndEncodeImage({ picker, manipulator })).toBeNull();
  });

  it('returns null when permission is denied', async () => {
    const { picker, manipulator } = fakeExpo();
    picker.requestMediaLibraryPermissionsAsync = vi.fn(async () => ({ granted: false }));
    expect(await pickAndEncodeImage({ picker, manipulator })).toBeNull();
    expect(picker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});
