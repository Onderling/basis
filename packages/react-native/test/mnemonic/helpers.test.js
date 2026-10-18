/**
 * mnemonic helpers — pure-fn coverage. Mirrors the assertions
 * apps/pinboard-mobile/test/mnemonic.test.js exercises through the
 * re-export shim.
 */

import { describe, it, expect } from 'vitest';
import {
  BIP39_WORD_COUNTS,
  normaliseMnemonic,
  mnemonicWords,
  hasValidWordCount,
  looksLikeMnemonic,
  statusFor,
} from '../../src/mnemonic/helpers.js';

describe('@onderling/react-native/mnemonic helpers', () => {
  it('BIP39_WORD_COUNTS is the standard ladder', () => {
    expect([...BIP39_WORD_COUNTS].sort((a, b) => a - b)).toEqual([12, 15, 18, 21, 24]);
  });

  it('normaliseMnemonic lowercases + collapses whitespace + trims', () => {
    expect(normaliseMnemonic('  HELLO   World  ')).toBe('hello world');
    expect(normaliseMnemonic('')).toBe('');
    expect(normaliseMnemonic(null)).toBe('');
  });

  it('mnemonicWords splits + filters empties', () => {
    expect(mnemonicWords('one  two\tthree')).toEqual(['one', 'two', 'three']);
    expect(mnemonicWords('')).toEqual([]);
  });

  it('hasValidWordCount accepts BIP-39 cardinalities', () => {
    expect(hasValidWordCount('a '.repeat(12).trim())).toBe(true);
    expect(hasValidWordCount('a '.repeat(13).trim())).toBe(false);
  });

  it('looksLikeMnemonic rejects malformed words', () => {
    expect(looksLikeMnemonic('a '.repeat(12).trim())).toBe(false); // too short
    expect(looksLikeMnemonic('apple '.repeat(12).trim())).toBe(true);
    expect(looksLikeMnemonic('apple1 '.repeat(12).trim())).toBe(false); // digit
  });

  it('statusFor returns the right status', () => {
    expect(statusFor('')).toBe('empty');
    expect(statusFor('one two')).toBe('too_short');
    expect(statusFor('one two three four five six seven')).toBe('wrong_count');
    const twelve = 'apple '.repeat(12).trim();
    expect(statusFor(twelve)).toBe('looks_ok');
    expect(statusFor(twelve.replace(/^apple /, 'app1e '))).toBe('malformed_word');
  });
});
