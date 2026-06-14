// Generic, config-driven redaction ENGINE — the locale-agnostic atom.
//
// `redact(text, config)` strips STRUCTURED identifiers with the caller's ordered
// regex rules, then (optionally) known names with a gazetteer. The engine bakes
// in NO locale content: every pattern, placeholder, validator selection and the
// whole name list arrive as DATA in `config`. Validators are looked up by name
// in the registry (./validators.js); the gazetteer heuristic lives in
// ./gazetteer.js. Pure, synchronous, dependency-free.
//
// This is the extraction of apps/feedback-pipeline's redact.js + names.js: the
// engine moved here; the NL ruleset stayed in the app as data.

import { VALIDATORS } from './validators.js';
import { redactGazetteer } from './gazetteer.js';

/**
 * @typedef {Object} RedactRule
 * @property {string} type        hit category + placeholder key
 * @property {string|RegExp} pattern  regex source (string) or a RegExp; the
 *                                 engine forces the global flag.
 * @property {string} [replacement]  text the match (or captured group) becomes;
 *                                 defaults to config.placeholders[type].
 * @property {string} [validate]  name of a registry validator; the match (after
 *                                `normalize`) must pass or the match is kept.
 * @property {'strip-spaces'|'strip-nondigits'} [normalize]  transform applied to
 *                                 the match BEFORE validation only (the hit value
 *                                 and placeholder substitution use the raw match).
 * @property {number} [captureGroup]  if set, only this capture group is replaced
 *                                 (the rest of the match is kept); the hit value
 *                                 is that group. Used for labelled ids that keep
 *                                 their keyword ("BSN is 123…" → "BSN is [bsn]").
 */

/**
 * @typedef {Object} RedactConfig
 * @property {RedactRule[]} rules
 * @property {Object<string,string>} [placeholders]  type → replacement string.
 * @property {Object} [gazetteer]  see ./gazetteer.js redactGazetteer.
 * @property {Object} [options]
 */

const NORMALIZERS = {
  'strip-spaces': (s) => s.replace(/\s/g, ''),
  'strip-nondigits': (s) => s.replace(/\D/g, ''),
};

function toGlobalRegExp(pattern) {
  if (pattern instanceof RegExp) {
    return pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
  }
  return new RegExp(pattern, 'g');
}

/**
 * Apply a redaction config to a single text.
 * @param {string} text
 * @param {RedactConfig} config
 * @returns {{ text: string, hits: Array<{type:string, value:string}> }}
 */
export function redact(text, config) {
  const { rules = [], placeholders = {}, gazetteer } = config || {};
  const hits = [];
  let out = text;

  for (const rule of rules) {
    const { type, validate, normalize, captureGroup } = rule;
    const replacement = rule.replacement ?? placeholders[type];
    const re = toGlobalRegExp(rule.pattern);
    const validator = validate ? VALIDATORS[validate] : null;
    if (validate && !validator) {
      throw new Error(`redact: unknown validator '${validate}' for rule type '${type}'`);
    }

    out = out.replace(re, (...args) => {
      const match = args[0];
      const groups = args.slice(1, -2); // drop offset + whole string
      // The value we test/record: the captured group when captureGroup is set,
      // else the whole match.
      const target = captureGroup != null ? groups[captureGroup - 1] : match;
      if (target == null) return match;

      if (validator) {
        const probe = normalize ? NORMALIZERS[normalize](target) : target;
        if (!validator(probe)) return match;     // failed validation → keep
      }

      hits.push({ type, value: target.trim() });

      if (captureGroup != null) {
        // Replace only the captured group within the match, keep the rest.
        return match.replace(target, replacement);
      }
      return replacement;
    });
  }

  if (gazetteer) {
    const g = redactGazetteer(out, gazetteer);
    out = g.text;
    hits.push(...g.hits);
  }

  return { text: out, hits };
}

/** Convenience: just the redacted text. */
export function redactText(text, config) {
  return redact(text, config).text;
}

export { VALIDATORS } from './validators.js';
export { redactGazetteer } from './gazetteer.js';
