/**
 * The recovery-phrase word grid.
 */
import { describe, it, expect } from 'vitest';
import { partitionMnemonicGrid } from '../src/core/mnemonicCreate.js';

describe('partitionMnemonicGrid', () => {
  it('numbers words 1..N and preserves order', () => {
    const grid = partitionMnemonicGrid('linnen veld tuin brug licht circle');
    expect(grid).toEqual([
      { n: 1, word: 'linnen' }, { n: 2, word: 'veld' },   { n: 3, word: 'tuin' },
      { n: 4, word: 'brug' },   { n: 5, word: 'licht' },  { n: 6, word: 'circle' },
    ]);
  });

  it('handles a 24-word BIP39 phrase', () => {
    const phrase = Array.from({ length: 24 }, (_, i) => `w${i + 1}`).join(' ');
    const grid = partitionMnemonicGrid(phrase);
    expect(grid).toHaveLength(24);
    expect(grid[0]).toEqual({ n: 1, word: 'w1' });
    expect(grid[23]).toEqual({ n: 24, word: 'w24' });
  });

  it('returns [] for non-string / empty / whitespace input', () => {
    expect(partitionMnemonicGrid(null)).toEqual([]);
    expect(partitionMnemonicGrid('')).toEqual([]);
    expect(partitionMnemonicGrid('   ')).toEqual([]);
  });

  it('collapses runs of whitespace', () => {
    const grid = partitionMnemonicGrid('  a   b\t\tc\n d   ');
    expect(grid.map((w) => w.word)).toEqual(['a', 'b', 'c', 'd']);
  });
});
