/**
 * @onderling/react-native/deepLinks — generic deep-link dispatcher.
 *
 * `parseDeepLink(url, {scheme, parsers, defaultPath?})` is pure JS;
 * apps supply per-path parsers + the per-app `<scheme>://` URL
 * scheme. The `actionToNavigation` mapping (deep-link kind → nav
 * route) stays app-side because it depends on the app's route table.
 *
 * Lifted from apps/pinboard-mobile/src/lib/deepLinks.js 2026-05-09
 * (Phase 41.0.b A6).
 */

export { parseDeepLink, parseQuery, parseTokenParam } from './parseDeepLink.js';
