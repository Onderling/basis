/**
 * basis-mobile — the recovery-phrase word grid.
 *
 * The phrase never opens by itself: Vandaag's key card says it is not saved yet, and only its explicit "Toon" opens
 * it (the saved / snoozed marks live in the shared onboardingFlags). This module only lays the words out.
 *
 * NOTE — design says "twaalf woorden" but the BIP39 substrate emits 24
 * words (256-bit entropy → 32-byte Ed25519 seed; see packages/core
 * Mnemonic.js).  Keep the substrate count; UI copy can read "Your
 * recovery phrase" without pinning a number.
 */

/**
 * Slice the mnemonic into a 2-column grid the screen can render
 * verbatim.  Returns `[{n, word}]` rows with 1-based numbering, in
 * column-major order (left column 1..12, right 13..24).  Defensive
 * against non-strings + short inputs.
 *
 * @param {string} mnemonic
 * @returns {Array<{ n: number, word: string }>}
 */
export function partitionMnemonicGrid(mnemonic) {
  if (typeof mnemonic !== 'string') return [];
  const words = mnemonic.trim().split(/\s+/).filter(Boolean);
  return words.map((word, i) => ({ n: i + 1, word }));
}

