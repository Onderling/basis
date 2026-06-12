// Project-level configuration.

// The language the aggregation/summaries are produced in. Cleaned messages are
// translated to this language BEFORE summarizing, so dedup compares like with
// like and every summary bullet is in one language. Override with FP_LANG.
// Default 'nl' — the product's primary market is Dutch (OR / zorg / UWV).
// `process` only exists under Node — guard it so this module (statically imported by the browser
// feedback surface) is browser-safe; an unguarded `process.env` threw `process is not defined` and
// crashed the whole web shell at boot (found 2026-06-11). Matches the guard idiom in ollama.js:25.
export const PREFERRED_LANGUAGE = ((typeof process !== 'undefined' && process.env ? process.env.FP_LANG : undefined) || 'nl').toLowerCase();

export const LANG_NAME = { nl: 'Dutch', en: 'English' };
export const langName = (code) => LANG_NAME[code] || 'Dutch';
