// Step 1b — deterministic NAME redaction via a first-name gazetteer.
//
// ⚠️ READ THIS BEFORE TRUSTING IT. Names are NOT like phone/email/IBAN. Those
// have rigid structure a regex matches precisely. Names are an OPEN, AMBIGUOUS
// set, so any fixed list is wrong in two directions at once (foreign names slip
// through; capitalised homographs over-match). This is a BEST-EFFORT first
// layer, NOT a guarantee — the real safeguards are the LLM backstop (step 2),
// human review (step 4) and the k-anonymity threshold (step 5). See
// ../docs/FINDINGS.md "On the limits of deterministic name redaction".
//
// test/names.test.js documents the false positives/negatives as executable
// evidence — several tests assert the WRONG behaviour on purpose, labelled as
// known limitations.
//
// As of P0 the gazetteer ENGINE lives in @canopy/redaction. This module is a
// THIN ADAPTER over the NL gazetteer DATA (./nl-redact-config.js). Behaviour is
// identical to the pre-extraction version.

import { redactGazetteer } from '@canopy/redaction';
import { NL_GAZETTEER, PLACEHOLDER_NAME, NAMES } from './nl-redact-config.js';

export { PLACEHOLDER_NAME };

/**
 * Redact known first names → [naam].
 * @param {string} text  (run AFTER structured redact() so it skips tokens)
 * @returns {{ text: string, hits: Array<{type:'name', value:string}> }}
 */
export function redactNames(text) {
  return redactGazetteer(text, NL_GAZETTEER);
}

/** For tests/introspection. */
export const KNOWN_NAME_COUNT = new Set(NAMES.map((n) => n.toLowerCase())).size;
