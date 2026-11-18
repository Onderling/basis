/**
 * gateWords — the household gate's words, per language, from the locale files (`src/locales/gate.<lang>.json`).
 *
 * Each entry is keyed by the rule's id (what the rule does stays in code, `circleGate.js`) and carries its `doc`
 * (English, for the person or model that translates), its `patterns` (phrase templates, `gatePhrases.js`), its
 * `examples` (must match and give the rule's op) and its `not` lines (must not match). The guard
 * (`test/fitness/gateWordsComplete.test.js`) runs every example and every `not` line in every language, and is red
 * for a rule a language does not carry. A new language is a new file, translated — not code.
 */
import gateNl from '../locales/gate.nl.json' with { type: 'json' };
import gateEn from '../locales/gate.en.json' with { type: 'json' };
import { compilePhrase } from './gatePhrases.js';

/** The languages the household's gate speaks, side by side (a person may write either). */
export const GATE_WORDS = Object.freeze({ nl: gateNl, en: gateEn });

/**
 * Compile every rule's patterns, of every language, into one list of forms per rule id.
 * @param {Record<string, Record<string, {patterns: string[]}>>} words  per language: rule id → entry
 * @param {{list?: string[]}} slots
 * @returns {Map<string, Array<ReturnType<typeof compilePhrase>>>}
 */
export function compileGateWords(words = GATE_WORDS, slots = {}) {
  const out = new Map();
  for (const entries of Object.values(words)) {
    for (const [id, entry] of Object.entries(entries ?? {})) {
      if (id.startsWith('_')) continue;   // a word list, not a rule (the trailing verbs)
      const forms = out.get(id) ?? [];
      for (const p of entry?.patterns ?? []) forms.push(compilePhrase(p, slots));
      out.set(id, forms);
    }
  }
  return out;
}

/** How a line OPENS when it asks how something works ("hoe …", "what is …"; the gate files' `_help.questions`), every
 *  language together, lower-cased: only a line that opens so is looked up in the help cards. */
export function helpQuestionOpeners(words = GATE_WORDS) {
  const out = [];
  for (const entries of Object.values(words)) for (const w of entries?._help?.questions ?? []) out.push(String(w).toLowerCase());
  return out;
}

/** How a person opens a line saying what they will do ("ik moet", "I need to"; the gate files' `_lead.words`), every
 *  language together, lower-cased, longest first: not part of the title of what the line makes. */
export function leadWords(words = GATE_WORDS) {
  const out = new Set();
  for (const entries of Object.values(words)) for (const w of entries?._lead?.words ?? []) out.add(String(w).toLowerCase());
  return [...out].sort((a, b) => b.length - a.length);
}

/** Words that point back at something said before ("zet DAT morgen in mijn agenda"; the gate files' `_refers.words`),
 *  every language together, lower-cased: only a model with the previous turns knows what such a line is about. */
export function referringWords(words = GATE_WORDS) {
  const out = new Set();
  for (const entries of Object.values(words)) for (const w of entries?._refers?.words ?? []) out.add(String(w).toLowerCase());
  return out;
}

/** The words around a pointing word in such a request ("zet … in mijn agenda"; `_refers.around`), every language
 *  together, lower-cased: a line of only these and a pointing word says nothing of its own. */
export function referringAround(words = GATE_WORDS) {
  const out = new Set();
  for (const entries of Object.values(words)) for (const w of entries?._refers?.around ?? []) out.add(String(w).toLowerCase());
  return out;
}

/** The whole lines that ask for help, every language together, lower-cased. */
export function helpWords(words = GATE_WORDS) {
  const out = new Set();
  for (const entries of Object.values(words)) for (const w of entries?._help?.words ?? []) out.add(String(w).toLowerCase());
  return out;
}

/** The trailing verbs per language ("afwas klaar"), as the manifest gate reads them: `{ <lang>: { complete: [...] } }`. */
export function trailingLexicon(words = GATE_WORDS) {
  const out = {};
  for (const [lang, entries] of Object.entries(words)) {
    const tr = entries?._trailing ?? {};
    out[lang] = Object.fromEntries(Object.entries(tr).filter(([k, v]) => k !== 'doc' && Array.isArray(v)));
  }
  return out;
}
