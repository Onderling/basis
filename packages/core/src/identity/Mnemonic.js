/**
 * BIP39 mnemonic ↔ 32-byte Ed25519 seed.
 *
 * We use 256-bit entropy → 24 words. The raw entropy bytes ARE the
 * Ed25519 seed (not the PBKDF2-stretched seed from mnemonicToSeed).
 * This keeps recovery simple: words → same keypair, deterministically.
 */
import {
  generateMnemonic  as bip39Generate,
  mnemonicToEntropy,
  entropyToMnemonic,
  validateMnemonic  as bip39Validate,
} from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

const BITS = 256; // 256 bits of entropy → 24 words → 32-byte seed

/** Generate a fresh 24-word BIP39 mnemonic. */
export function generateMnemonic() {
  return bip39Generate(wordlist, BITS);
}

/**
 * Convert a mnemonic to its 32-byte entropy seed.
 * @param   {string}     mnemonic
 * @returns {Uint8Array} 32-byte seed
 */
export function mnemonicToSeed(mnemonic) {
  return mnemonicToEntropy(mnemonic.trim(), wordlist);
}

/**
 * Convert a 32-byte seed back to a mnemonic.
 * The round trip mnemonicToSeed → seedToMnemonic is stable.
 * @param   {Uint8Array} seed
 * @returns {string}
 */
export function seedToMnemonic(seed) {
  return entropyToMnemonic(seed, wordlist);
}

/** Return true if the mnemonic is a valid 24-word BIP39 string. */
export function validateMnemonic(mnemonic) {
  return bip39Validate(mnemonic.trim(), wordlist);
}
