/**
 * pickAndResize — open the camera or photo library, resize the
 * captured image(s) per the supplied preset, return the canonical
 * `PickedImage` shape.
 *
 * Lifted from apps/pinboard-mobile/src/lib/imagePicker.js 2026-05-09
 * (Phase 41.0 L3; Tasks-mobile is the second consumer).
 *
 * Output shape — byte-identical to the web side
 * (apps/pinboard/web/lib/imageResize.js):
 *   {mime, width, height, dataB64, bytes, thumbnail}
 *
 * Output is always JPEG. The MIME field is fixed for forward-compat;
 * callers shouldn't assume the input format survives.
 *
 * The expo modules are imported via `_modules` so tests can inject
 * stubs without going through `vi.mock`. Production callers don't
 * touch `_modules`.
 */

const MIME_OUT = 'image/jpeg';

/**
 * @typedef {import('./presets.js').PickerPreset} PickerPreset
 *
 * @typedef {object} PickedImage
 * @property {'image/jpeg'} mime
 * @property {number}       width
 * @property {number}       height
 * @property {string}       dataB64    full bytes, base64
 * @property {number}       bytes      approx byte count
 * @property {string}       thumbnail  data:image/jpeg;base64,...
 */

/**
 * Open the camera (preferred) and resize the captured image. When the
 * user cancels, returns null. When the OS denies camera permission,
 * throws an Error with `code: 'PERMISSION_DENIED'`.
 *
 * @param {PickerPreset} preset
 * @param {object} [opts]
 * @param {object} [opts._modules]   inject stubs for tests
 * @returns {Promise<PickedImage | null>}
 */
export async function captureWithCamera(preset, { _modules } = {}) {
  if (!preset) throw new Error('captureWithCamera: preset required');
  const { ImagePicker, manipulateAsync, SaveFormat } = _modules ?? await _loadDefaults();

  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    const err = new Error('imagePicker: camera permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes:    ImagePicker.MediaTypeOptions?.Images ?? 'Images',
    allowsEditing: false,
    quality:       1,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return _processAsset(result.assets[0], preset, { manipulateAsync, SaveFormat });
}

/**
 * Open the photo library; allow up to N images. When the user cancels,
 * returns []. When the OS denies media-library permission, throws an
 * Error with `code: 'PERMISSION_DENIED'`.
 *
 * @param {PickerPreset} preset
 * @param {number} max
 * @param {object} [opts]
 * @returns {Promise<PickedImage[]>}
 */
export async function pickFromLibrary(preset, max = 4, { _modules } = {}) {
  if (!preset) throw new Error('pickFromLibrary: preset required');
  const { ImagePicker, manipulateAsync, SaveFormat } = _modules ?? await _loadDefaults();

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    const err = new Error('imagePicker: media-library permission denied');
    err.code = 'PERMISSION_DENIED';
    throw err;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes:              ImagePicker.MediaTypeOptions?.Images ?? 'Images',
    allowsEditing:           false,
    quality:                 1,
    allowsMultipleSelection: max > 1,
    selectionLimit:          max,
  });
  if (result.canceled || !Array.isArray(result.assets)) return [];

  const out = [];
  for (const a of result.assets.slice(0, max)) {
    try { out.push(await _processAsset(a, preset, { manipulateAsync, SaveFormat })); }
    catch { /* swallow per-asset failure; the rest still ship */ }
  }
  return out;
}

/**
 * The plan's primary entry-point: pass `mode` + `preset` + `max`,
 * receive a `PickedImage[]` (length 0..max). `mode === 'camera'`
 * returns at most 1; `mode === 'library'` returns up to `max`.
 *
 * @param {object} args
 * @param {'camera' | 'library'} args.mode
 * @param {PickerPreset}         args.preset
 * @param {number}               [args.max=4]
 * @param {object}               [args._modules]
 * @returns {Promise<PickedImage[]>}
 */
export async function pickAndResize({ mode, preset, max = 4, _modules } = {}) {
  if (!preset) throw new Error('pickAndResize: preset required');
  if (mode === 'camera') {
    const one = await captureWithCamera(preset, { _modules });
    return one ? [one] : [];
  }
  if (mode === 'library') {
    return pickFromLibrary(preset, max, { _modules });
  }
  return [];
}

// ── Internals ────────────────────────────────────────────────────────────────

async function _loadDefaults() {
  const ImagePicker = await import('expo-image-picker');
  const Manip       = await import('expo-image-manipulator');
  return {
    ImagePicker,
    manipulateAsync: Manip.manipulateAsync,
    SaveFormat:      Manip.SaveFormat,
  };
}

async function _processAsset(asset, preset, { manipulateAsync, SaveFormat }) {
  const { uri, width, height } = asset;
  if (!uri) throw new Error('imagePicker: asset has no uri');

  const dims = _scaleToFit(width ?? 0, height ?? 0, preset.maxEdgePx);
  const full = await manipulateAsync(
    uri,
    [{ resize: { width: dims.width, height: dims.height } }],
    { compress: preset.quality,      format: SaveFormat.JPEG, base64: true },
  );

  const thumbDims = _scaleToFit(width ?? 0, height ?? 0, preset.thumbEdgePx);
  const thumb = await manipulateAsync(
    uri,
    [{ resize: { width: thumbDims.width, height: thumbDims.height } }],
    { compress: preset.thumbQuality, format: SaveFormat.JPEG, base64: true },
  );

  const dataB64 = full.base64 ?? '';
  const bytes   = Math.floor(dataB64.length * 0.75);

  return {
    mime:      MIME_OUT,
    width:     full.width  ?? dims.width,
    height:    full.height ?? dims.height,
    dataB64,
    bytes,
    thumbnail: `data:${MIME_OUT};base64,${thumb.base64 ?? ''}`,
  };
}

function _scaleToFit(srcW, srcH, maxEdge) {
  if (!srcW || !srcH) return { width: maxEdge, height: maxEdge };
  if (srcW <= maxEdge && srcH <= maxEdge) {
    return { width: srcW, height: srcH };
  }
  const ratio = srcW > srcH ? maxEdge / srcW : maxEdge / srcH;
  return {
    width:  Math.round(srcW * ratio),
    height: Math.round(srcH * ratio),
  };
}

export const _internal = { _scaleToFit, _processAsset, _loadDefaults, MIME_OUT };
