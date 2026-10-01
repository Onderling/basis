/**
 * gateVerbs — the words an op's deterministic match starts with, per language.
 *
 * A manifest declares THAT an op has gate words, and how the rest of the line is read (`surfaces.slash.match`:
 * `body`, `arg`, …). The words themselves are data the app ships beside its manifest, one file per language
 * (`gate.<lang>.json`, keyed by `<app>.<op>`, each entry with `doc`, `verbs`, `examples`, `not`), carried on the
 * manifest as `gateWords: { <lang>: entries }` — so a translator reaches them, a received manifest brings them, and
 * the words guard runs each entry's own examples. A verb is a phrase ("zet afspraak"), split on spaces. The trailing
 * connector words a match drops ("tandarts MET Bert" → "tandarts") are words too: the manifest says THAT the match
 * drops them (`dropTrailing: true`), the entry which (`dropTrailing: ["with"]`), per language.
 *
 * With a locale the manifest has words for, only that language's verbs match; without one (or one it has no words
 * for), every language's do, in the order the files were given. An op whose app has not moved its words yet keeps
 * `match.verbs` on the manifest.
 *
 * @param {object} manifest
 * @param {object} op
 * @param {string|null} [locale]
 * @returns {Array<string[]>} each verb as its words
 */
export function gateVerbsOf(manifest, op, locale = null) {
  const words = manifest?.gateWords;
  if (words && typeof words === 'object') {
    const key = `${manifest.appId ?? manifest.app}.${op?.id}`;
    const langs = locale && words[locale] ? [locale] : Object.keys(words);
    const out = [];
    for (const lang of langs) {
      for (const v of words[lang]?.[key]?.verbs ?? []) {
        const tokens = String(v).trim().split(/\s+/).filter(Boolean);
        // a word both languages use ("download") is in both files; it matches once
        if (tokens.length && !out.some((o) => o.join(' ').toLowerCase() === tokens.join(' ').toLowerCase())) out.push(tokens);
      }
    }
    if (out.length || langs.some((l) => words[l]?.[key])) return out;
  }
  const declared = op?.surfaces?.slash?.match?.verbs;
  return Array.isArray(declared) ? declared.map((v) => (Array.isArray(v) ? v : [v])) : [];
}

/**
 * The connector words this op's match drops from the end of its body, for a locale (same rule as the verbs: the
 * locale's, or every language's without one), or null when the match drops none. An app that has not moved yet keeps
 * the list on the manifest.
 * @returns {string[]|null}
 */
export function gateDropTrailingOf(manifest, op, locale = null) {
  const declared = op?.surfaces?.slash?.match?.dropTrailing;
  if (Array.isArray(declared)) return declared.length ? declared : null;
  if (declared !== true) return null;
  const words = manifest?.gateWords ?? {};
  const key = `${manifest.appId ?? manifest.app}.${op?.id}`;
  const langs = locale && words[locale] ? [locale] : Object.keys(words);
  const out = [];
  for (const lang of langs) for (const w of words[lang]?.[key]?.dropTrailing ?? []) if (!out.includes(w)) out.push(w);
  return out.length ? out : null;
}
