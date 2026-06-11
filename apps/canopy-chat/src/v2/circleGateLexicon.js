// Per-language TRAILING-verb lexicon for the deterministic circle gate.
//
// The gate matches an action verb in free text and routes straight to a task op, skipping the
// (unreliable) small-LLM tool-pick. Verbs are normally sentence-INITIAL ("done X"); this lexicon
// adds the natural TRAILING form ("X done", "afwas klaar") for completion. `renderSlash` tries the
// trailing forms ONLY after every leading match fails, so "done X" always wins over "X done".
//
// Selected by the user's locale (canopy-chat `currentLang` = 'en' | 'nl'). Leading verbs stay a mixed
// list on the manifest (they already match regardless of language); only this NEW trailing surface is
// per-locale. Slash commands stay strict/canonical — this is only the fuzzy gate surface.
//
// The `nl` list deliberately includes common ENGLISH verbs ("done", "finished") because Dutch
// speakers code-switch ("kaas done"). A new language = a new locale block. Keyed by INTENT (the op's
// `surfaces.slash.match.trailing` value), not op-id, so several ops can share one intent. Trailing
// verbs are SINGLE words only — multiword leading phrases ("klaar met") don't trail.
export const CIRCLE_GATE_TRAIL = {
  en: {
    complete: ['done', 'complete', 'completed', 'finished'],
  },
  nl: {
    complete: ['klaar', 'gedaan', 'voltooid', 'af', 'done', 'finished'],
  },
};

/** Fallback locale when the user's setting is missing or unsupported. */
export const DEFAULT_GATE_LOCALE = 'en';
