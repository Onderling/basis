/**
 * @onderling/react-native/qr — QR substrate.
 *
 * Two pieces:
 *   - `classifyQrPayload(text, classifiers)` — the pure first-match dispatcher, re-exported from
 *     `@onderling/qr` (its one home, shared with the web router). Apps register their own classifier list.
 *   - `<QrCodeView value={...}>` — renderer wrapping
 *     `react-native-qrcode-svg`.
 *
 * Lifted from `apps/pinboard-mobile/src/lib/qrScanner.js` +
 * `src/components/QrCode.js` 2026-05-09 (Phase 41.0 L4; Tasks-mobile
 * is the second consumer).
 */

export { classifyQrPayload } from '@onderling/qr';

// `QrCodeView` is a separate subpath import so the pure-JS classifier
// is parseable in test environments that don't load
// `react-native-qrcode-svg` (a TS module). Apps that need the renderer
// import via `@onderling/react-native/qr/view`.
