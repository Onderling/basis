/**
 * @onderling/react-native/picker — image + document picker substrate.
 *
 * Two flavours:
 *   - `pickAndResize` (image) — camera + library, JPEG-normalised
 *     with thumbnail. Apps pick a preset (size + quality knobs).
 *     Stoop's NOTICEBOARD/CHAT/AVATAR presets stay in apps/stoop-mobile/
 *     src/lib/imagePicker.js (which re-exports through this submodule).
 *     Generic `DELIVERABLE_PRESET` + `AVATAR_PRESET` live here for apps
 *     that don't need a custom shape.
 *   - `pickDocument` / `pickOneDocument` (any file) — expo-document-
 *     picker + expo-file-system, returns {name, mime, bytes, dataB64}.
 *     Used by basis-mobile's `/embed-file --pick` and friends
 *     
 */

export {
  pickAndResize,
  captureWithCamera,
  pickFromLibrary,
} from './pickAndResize.js';

export {
  pickDocument,
  pickOneDocument,
} from './pickDocument.js';

export {
  DELIVERABLE_PRESET,
  AVATAR_PRESET,
} from './presets.js';
