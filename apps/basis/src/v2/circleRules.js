/**
 * basis v2 — circle rules document (shared, boards 3B/3C).
 *
 * A circle's governance, captured as a short document across seven aspects
 * (purpose / admins / agreements / conflict / admission / leaving /
 * responsibility). The create flow fills it via SIX plain-language
 * questions (responsibility folds into "agreements", so it isn't asked
 * separately but stays a field), and the join flow shows the assembled
 * document as an Agree / Decline consent screen. This module is the pure
 * model: field list, the question set, normalisation, build-from-answers,
 * and a completeness check over the required fields.
 *
 * Additive: the standalone editor + consent renderers ship now; threading
 * this into the existing createGroup/joinGroup wizard state machines is a
 * follow-on so those shared wizards stay stable.
 */

/** The seven aspects stored in the rules document. */
export const RULES_FIELDS = [
  'purpose', 'admins', 'agreements', 'conflict', 'admission', 'leaving', 'responsibility',
];

/**
 * The six questions asked at creation, in order. Each writes one field;
 * `responsibility` is folded into the agreements answer (not asked). Only
 * `purpose` + `agreements` are required so creating a circle stays quick.
 */
export const RULES_QUESTIONS = [
  { key: 'purpose',    required: true  },
  { key: 'admins',     required: false },
  { key: 'agreements', required: true  },
  { key: 'conflict',   required: false },
  { key: 'admission',  required: false },
  { key: 'leaving',    required: false },
];

/** An empty document — every field a string. */
export const DEFAULT_RULES_DOC = Object.fromEntries(RULES_FIELDS.map((k) => [k, '']));

/** Coerce a stored partial into a complete doc (every field a trimmed-tolerant string). */
export function normalizeRulesDoc(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const k of RULES_FIELDS) out[k] = typeof r[k] === 'string' ? r[k] : '';
  return out;
}

/** Build a doc from `answers` keyed by field (merges onto a normalized base). */
export function buildRulesDoc(answers = {}) {
  return normalizeRulesDoc({ ...DEFAULT_RULES_DOC, ...(answers && typeof answers === 'object' ? answers : {}) });
}

/**
 * The structured rules out of a `getGroupRules` answer: the agent's answer carries them as `doc` (its `rules` is the
 * rendered text); the raw pinboard skill answers the stored item, with them under `source.rules`. Null when the
 * circle has none. The one reader for every screen that shows or edits a circle's rules.
 */
export function rulesDocFromAnswer(res) {
  const d = res?.doc ?? res?.rules?.source?.rules ?? null;
  return d && typeof d === 'object' ? d : null;
}

/** True when every REQUIRED question has a non-blank answer. */
export function isRulesComplete(doc) {
  const d = normalizeRulesDoc(doc);
  return RULES_QUESTIONS.filter((q) => q.required).every((q) => d[q.key].trim() !== '');
}

/** True when the whole document is blank (nothing to show a joiner). */
export function isRulesEmpty(doc) {
  const d = normalizeRulesDoc(doc);
  return RULES_FIELDS.every((k) => d[k].trim() === '');
}
