/**
 * attachmentPicker — S5 mobile image attachment (RN, expo).
 *
 * Mobile parity for web's `src/v2/attachmentEncoder.js`. Picks an image
 * (expo-image-picker), resizes + re-encodes it (expo-image-manipulator) into the
 * SAME inbound-attachment shape stoop.postRequest expects (and
 * validateInboundAttachment checks):
 *
 *   { mime, dataB64, width, height, thumbnail }
 *
 * The full image is capped to the 600KB noticeboard limit by longest-edge resize +
 * compression; the ~120px JPEG `thumbnail` (a `data:` URL) is what travels in the
 * broadcast. The native modules are injected (`picker`, `manipulator`) so the
 * shaping logic is unit-testable with fakes — mirrors the web encoder's seam.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — attachment caps. Reuse the SHARED keys (same tunable as the web encoder + stoop
// Attachments) so the by-value mirror is documented as one param. scope:device, kind:internal.
export const MAX_NOTICEBOARD_BYTES_PER_ATT = param({ key: 'attachment.maxNoticeboardBytesPerAtt', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 600_000 });   // mirror web encoder / stoop Attachments
const DEFAULT_MAX_DIM = param({ key: 'attachment.maxImageDim', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 1280 });
const THUMB_DIM = 120;

/** Shape a manipulator result + thumbnail into the inbound-attachment record. Pure. */
export function toInboundAttachment({ full, thumbBase64, mime = 'image/jpeg' }) {
  if (!full || typeof full.base64 !== 'string' || !full.base64) return null;
  return {
    mime,
    dataB64:   full.base64,
    width:     full.width,
    height:    full.height,
    thumbnail: `data:image/jpeg;base64,${thumbBase64}`,
  };
}

/**
 * Pick an image + encode it. Returns the inbound-attachment record, or null when
 * the user cancels / permission is denied. Throws on encode failure.
 *
 * @param {object} [deps] injected for testing; default to the expo modules.
 */
export async function pickAndEncodeImage({
  picker,
  manipulator,
  maxDim = DEFAULT_MAX_DIM,
} = {}) {
  // Lazy-require so a non-RN test environment can run the pure helper without
  // the native modules present.
  /* eslint-disable global-require */
  const ImagePicker = picker || require('expo-image-picker');
  const ImageManipulator = manipulator || require('expo-image-manipulator');
  /* eslint-enable global-require */

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
  if (perm && perm.granted === false) return null;

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'Images',
    quality: 1,
  });
  if (res?.canceled) return null;
  const asset = res?.assets?.[0];
  if (!asset?.uri) return null;

  // Full image — resize the longest edge to maxDim, JPEG @ 0.7.
  const longest = Math.max(asset.width || maxDim, asset.height || maxDim);
  const resizeAction = longest > maxDim
    ? [{ resize: (asset.width || 0) >= (asset.height || 0) ? { width: maxDim } : { height: maxDim } }]
    : [];
  const full = await ImageManipulator.manipulateAsync(asset.uri, resizeAction, {
    compress: 0.7, format: ImageManipulator.SaveFormat?.JPEG ?? 'jpeg', base64: true,
  });

  // Thumbnail — ~120px JPEG @ 0.6.
  const thumb = await ImageManipulator.manipulateAsync(asset.uri, [{ resize: { width: THUMB_DIM } }], {
    compress: 0.6, format: ImageManipulator.SaveFormat?.JPEG ?? 'jpeg', base64: true,
  });

  return toInboundAttachment({ full, thumbBase64: thumb.base64, mime: 'image/jpeg' });
}

/** The face's size and cap — the fold's, so a picture that gets past here gets past every receiver. */
export const FACE_DIM = 96;
export const FACE_MAX_CHARS = 4096;

/**
 * Pick a picture and encode it as a FACE: a `data:image/jpeg` URL at most 4096 characters.
 *
 * Web parity: `attachmentEncoder.encodeImageFile(file, { maxDim: 96, maxBytes: 2900 })`. Same two facts on
 * both shells — 96 px, and a quality ladder rather than one shot, because the cap is on the data-URL STRING
 * and base64 is a third larger than the bytes it carries. Always JPEG: a face needs no transparency, and PNG
 * has no quality to trade away, so it is the one format that can come out over the cap with nothing to do
 * about it.
 *
 * @returns {Promise<{thumb: string}|{error: string}|null>} null = the person cancelled or refused permission
 */
export async function pickFace({ picker, manipulator } = {}) {
  /* eslint-disable global-require */
  const ImagePicker = picker || require('expo-image-picker');
  const ImageManipulator = manipulator || require('expo-image-manipulator');
  /* eslint-enable global-require */

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync?.();
  if (perm && perm.granted === false) return null;
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions?.Images ?? 'Images',
    quality: 1,
  });
  if (res?.canceled) return null;
  const asset = res?.assets?.[0];
  if (!asset?.uri) return null;

  const format = ImageManipulator.SaveFormat?.JPEG ?? 'jpeg';
  const resize = [{ resize: (asset.width || 0) >= (asset.height || 0) ? { width: FACE_DIM } : { height: FACE_DIM } }];
  let last = 0;
  for (const compress of [0.85, 0.7, 0.55, 0.4]) {
    const out = await ImageManipulator.manipulateAsync(asset.uri, resize, { compress, format, base64: true });
    if (typeof out?.base64 !== 'string' || !out.base64) continue;
    const thumb = `data:image/jpeg;base64,${out.base64}`;
    if (thumb.length <= FACE_MAX_CHARS) return { thumb };
    last = thumb.length;
  }
  // Every quality tried and still too big — a refusal the person can act on (a different picture), rather
  // than a statement every other device would refuse in silence.
  return { error: `${last} > ${FACE_MAX_CHARS}` };
}
