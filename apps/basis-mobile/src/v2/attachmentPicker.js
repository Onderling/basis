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
