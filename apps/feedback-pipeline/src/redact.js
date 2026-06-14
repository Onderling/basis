// Step 1 of the local filter pipeline — deterministic STRUCTURED redaction.
//
// Strips structured identifiers (phone, email, IBAN, postcode, URL, BSN,
// street+number, …) with plain regex. These are exactly the things the local
// LLMs leak inconsistently (see ../docs/FINDINGS.md), so we do NOT trust a model
// with them — a regex is 100% reliable, instant and free. Names and profanity
// are fuzzy and language-dependent, so they are left to the gazetteer (./names.js)
// + the LLM (step 2, ./prompts.js).
//
// This split is the architectural guarantee the product leans on
// ("drempel ingebouwd" / "het kan architectonisch niet anders").
//
// As of P0 the redaction ENGINE lives in @canopy/redaction (generic,
// config-driven). This module is now a THIN ADAPTER: it owns only the NL ruleset
// as DATA (./nl-redact-config.js) and calls the engine bound to it. Public
// behaviour is identical to the pre-extraction version.

import { redact as engineRedact } from '@canopy/redaction';
import { NL_STRUCTURED_CONFIG, PLACEHOLDER } from './nl-redact-config.js';

export { PLACEHOLDER };

/**
 * Redact structured identifiers from a single message.
 * @param {string} text
 * @returns {{ text: string, hits: Array<{type:string, value:string}> }}
 */
export function redact(text) {
  return engineRedact(text, NL_STRUCTURED_CONFIG);
}

/** Convenience: just the redacted text. */
export function redactText(text) {
  return redact(text).text;
}
