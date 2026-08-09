/**
 * mnemonic helpers — pure-fn validation for the OnboardRestore /
 * Profile-recovery screens. Lifted from
 * apps/stoop-mobile/src/lib/mnemonic.js 2026-05-09 (Phase 41.0 L5;
 * Tasks-mobile is the second consumer).
 *
 * BIP-39 wordlist validation lives in the SDK
 * (`@scure/bip39/wordlists/english` + `validateMnemonic`). The
 * substrate-side helpers below are limited to:
 *
 *   1. Normalise the user's input (lowercase, collapse whitespace).
 *   2. Tell whether the word count is on the BIP-39 ladder.
 *   3. Tell whether every "word" looks BIP-39-shaped (lowercase
 *      ASCII, length 3-8). Deeper validation against the wordlist
 *      is the SDK's job — the screen surfaces the SDK's verdict.
 *
 * The same shape is used by `qrScanner.classifyQrPayload`'s recovery
 * classifier; the two are deliberately consistent.
 */

import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/core';

export const BIP39_WORD_COUNTS = Object.freeze(new Set([12, 15, 18, 21, 24]));

// Parameter register (#36) — BIP-39-shaped word-length bounds (scope:device, kind:internal).
const MIN_WORD_LEN = param({ key: 'rnMnemonic.minWordLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 3 });
const MAX_WORD_LEN = param({ key: 'rnMnemonic.maxWordLen', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8 });

/**
 * Lowercase the input, collapse whitespace runs to a single space,
 * trim leading/trailing whitespace.
 */
export function normaliseMnemonic(text) {
  if (typeof text !== 'string') return '';
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Split a normalised mnemonic into its words. */
export function mnemonicWords(text) {
  const norm = normaliseMnemonic(text);
  if (!norm) return [];
  return norm.split(' ').filter(Boolean);
}

/** Word-count check (no wordlist validation). */
export function hasValidWordCount(text) {
  return BIP39_WORD_COUNTS.has(mnemonicWords(text).length);
}

/** Cheap structural check; the SDK's `validateMnemonic` is authoritative. */
export function looksLikeMnemonic(text) {
  const words = mnemonicWords(text);
  if (!BIP39_WORD_COUNTS.has(words.length)) return false;
  return words.every((w) =>
    /^[a-z]+$/.test(w) &&
    w.length >= MIN_WORD_LEN &&
    w.length <= MAX_WORD_LEN);
}

/**
 * Short status string the UI can render under the input as the user types.
 * @returns {'empty' | 'too_short' | 'wrong_count' | 'malformed_word' | 'looks_ok'}
 */
export function statusFor(text) {
  const words = mnemonicWords(text);
  if (words.length === 0) return 'empty';
  if (words.length < 12) return words.length <= 3 ? 'too_short' : 'wrong_count';
  if (!BIP39_WORD_COUNTS.has(words.length)) return 'wrong_count';
  for (const w of words) {
    if (!/^[a-z]+$/.test(w))                           return 'malformed_word';
    if (w.length < MIN_WORD_LEN || w.length > MAX_WORD_LEN) return 'malformed_word';
  }
  return 'looks_ok';
}
