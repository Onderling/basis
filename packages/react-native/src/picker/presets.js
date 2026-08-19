/**
 * Image-picker presets — knobs that tune resize / quality. Apps
 * provide their own presets per use case (chat thumbnail, avatar,
 * noticeboard post, deliverable photo, …).
 *
 * Lifted from apps/stoop-mobile/src/lib/imagePicker.js 2026-05-09
 * (Phase 41.0 L3; Tasks-mobile is the second consumer). Stoop's
 * three presets stay there (re-exported through the shim); generic
 * presets live here so apps that just want a sensible default can
 * import directly.
 */

/**
 * @typedef {object} PickerPreset
 * @property {number} maxEdgePx     full-image max edge length
 * @property {number} thumbEdgePx   thumbnail max edge length
 * @property {number} quality       JPEG quality (0..1) for full
 * @property {number} thumbQuality  JPEG quality (0..1) for thumbnail
 */

/** Plan default for tasks deliverable photos: 1280px JPEG, q=0.82. */
export const DELIVERABLE_PRESET = Object.freeze({
  maxEdgePx:    1280,
  thumbEdgePx:  120,
  quality:      0.82,
  thumbQuality: 0.7,
});

/** Plan default for avatar: 256px JPEG, q=0.85. */
export const AVATAR_PRESET = Object.freeze({
  maxEdgePx:    256,
  thumbEdgePx:  64,
  quality:      0.85,
  thumbQuality: 0.7,
});
