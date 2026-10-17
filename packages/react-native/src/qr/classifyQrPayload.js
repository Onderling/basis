/**
 * classifyQrPayload — generic, plugin-driven QR payload classifier.
 *
 * Lifted from apps/pinboard-mobile/src/lib/qrScanner.js 2026-05-09
 * (Phase 41.0 L4; Tasks-mobile is the second consumer). Pinboard's
 * three classifiers (invite/contact/recovery) stay in pinboard-mobile
 * (they're Pinboard-payload-shaped); Tasks-mobile registers its own
 * (e.g. `tasks://invite`, `tasks://bot-token`).
 *
 * `classifyQrPayload(text, classifiers)` walks `classifiers` in
 * order; the first one that returns a non-null payload wins. When
 * none match, returns `{kind: 'unknown'}` so callers can branch on
 * `kind` without null-checking.
 *
 * Each classifier is `{kind: string, classify: (text: string) => payload | null}`.
 * Pure JS — no Expo / camera deps. The camera component calls this
 * on each barcode-detected callback.
 */

/**
 * @typedef {object} QrClassifier
 * @property {string} kind
 * @property {(text: string) => unknown | null} classify
 *
 * @typedef {{kind: string, payload: unknown}} ClassifiedKnown
 * @typedef {{kind: 'unknown'}} ClassifiedUnknown
 * @typedef {ClassifiedKnown | ClassifiedUnknown} Classified
 */

/**
 * @param {string} text                 raw scanned barcode text
 * @param {QrClassifier[]} [classifiers]   first match wins
 * @returns {Classified}
 */
export function classifyQrPayload(text, classifiers = []) {
  if (typeof text !== 'string' || text.length === 0) return { kind: 'unknown' };
  if (!Array.isArray(classifiers)) return { kind: 'unknown' };
  const trimmed = text.trim();
  for (const c of classifiers) {
    if (!c || typeof c.classify !== 'function' || typeof c.kind !== 'string') continue;
    let payload;
    try { payload = c.classify(trimmed); }
    catch { payload = null; }
    if (payload != null) return { kind: c.kind, payload };
  }
  return { kind: 'unknown' };
}
