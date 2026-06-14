// @canopy/redaction — generic, config-driven redaction atom.
//
// `redact(text, config) -> { text, hits }` applies ordered regex rules (with an
// optional named-validator) plus an optional gazetteer name-pass. The engine is
// locale-agnostic: callers supply ALL locale content (patterns, placeholders,
// name list, titles) as data. See ./redact.js for the RedactConfig shape.

export { redact, redactText } from './redact.js';
export { VALIDATORS, bsn11proef, nlPhone, iban, luhn } from './validators.js';
export { redactGazetteer } from './gazetteer.js';
