/**
 * Parse JSON that someone else wrote — a peer's payload, a scanned or pasted code, a file or a pod resource another
 * device made. A key that reaches a prototype (`__proto__`, `constructor`, `prototype`), at any depth, refuses the
 * WHOLE input: `JSON.parse` keeps `"__proto__"` as an ordinary own key, and the first `Object.assign` (or key-copy
 * loop) that merges the result then sets the target's prototype — fields that read as present without being there.
 * Refusing at the parse means no decoder downstream has to remember. Throws an Error (a SyntaxError for malformed
 * JSON, as `JSON.parse` does), so a decoder's existing catch turns either into its refusal.
 */

/** The keys a parsed input may not carry. */
export const UNSAFE_JSON_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const UNSAFE = new Set(UNSAFE_JSON_KEYS);

/**
 * `JSON.parse` for someone else's JSON: the same result, or a refusal when any key reaches a prototype.
 * @param {string} text
 * @returns {unknown} what `JSON.parse(text)` returns
 * @throws {SyntaxError} malformed JSON
 * @throws {Error} a key that reaches a prototype (`code: 'UNSAFE_JSON_KEY'`)
 */
export function parseUntrustedJson(text) {
  return JSON.parse(text, (key, value) => {
    if (UNSAFE.has(key)) throw Object.assign(new Error(`untrusted JSON: unsafe key "${key}"`), { code: 'UNSAFE_JSON_KEY' });
    return value;
  });
}
