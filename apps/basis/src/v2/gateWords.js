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
      const forms = out.get(id) ?? [];
      for (const p of entry?.patterns ?? []) forms.push(compilePhrase(p, slots));
      out.set(id, forms);
    }
  }
  return out;
}
