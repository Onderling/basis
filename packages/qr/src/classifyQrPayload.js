/**
 * classifyQrPayload — the ONE first-match loop over a list of classifiers (`lint-one-scan-loop` holds it).
 *
 * `classifyQrPayload(text, classifiers)` walks `classifiers` in order; the first one that returns a non-null payload
 * wins. When none match, it returns `{kind: 'unknown'}` so callers can branch on `kind` without null-checking.
 *
 * Each classifier is `{kind: string, classify: (text: string) => payload | null}`. Pure JS — no React Native, no Expo,
 * no camera: the web router (`routeScan` in basis) and the phone's scanner (through the React Native package's `qr` entry, which
 * re-exports it) both call this one. Which classifiers there are is the app's (basis: `SCAN_CLASSIFIERS`).
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
