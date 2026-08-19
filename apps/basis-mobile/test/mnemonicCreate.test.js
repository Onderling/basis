/**
 * first-run mnemonic display (CREATE-side) helper tests.
 */
import { describe, it, expect } from 'vitest';
import {
  shouldShowCreateMnemonic, markMnemonicAck, clearMnemonicAck,
  partitionMnemonicGrid, MNEMONIC_ACK_KEY,
} from '../src/core/mnemonicCreate.js';

function makeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem:    async (k) => (map.has(k) ? map.get(k) : null),
    setItem:    async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
  };
}

describe('shouldShowCreateMnemonic', () => {
  it('returns true on a fresh storage (no ack)', async () => {
    expect(await shouldShowCreateMnemonic(makeStorage({}))).toBe(true);
  });

  it('returns false once the ack flag is set', async () => {
    expect(await shouldShowCreateMnemonic(makeStorage({ [MNEMONIC_ACK_KEY]: '1' }))).toBe(false);
  });

  it('treats a thrown getItem as "show again" (fail-open)', async () => {
    const broken = { getItem: async () => { throw new Error('storage down'); } };
    expect(await shouldShowCreateMnemonic(broken)).toBe(true);
  });

  it('returns false for falsy / no-getItem storage (defensive — never re-show on broken host)', async () => {
    expect(await shouldShowCreateMnemonic(null)).toBe(false);
    expect(await shouldShowCreateMnemonic({})).toBe(false);
  });
});

describe('markMnemonicAck', () => {
  it('persists "1" for kind=written', async () => {
    const s = makeStorage();
    await markMnemonicAck(s, 'written');
    expect(s.map.get(MNEMONIC_ACK_KEY)).toBe('1');
    expect(await shouldShowCreateMnemonic(s)).toBe(false);
  });

  it('persists "1" for kind=photo', async () => {
    const s = makeStorage();
    await markMnemonicAck(s, 'photo');
    expect(s.map.get(MNEMONIC_ACK_KEY)).toBe('1');
  });

  it('does NOT persist for kind=later (banner can re-nudge)', async () => {
    const s = makeStorage();
    await markMnemonicAck(s, 'later');
    expect(s.map.has(MNEMONIC_ACK_KEY)).toBe(false);
    expect(await shouldShowCreateMnemonic(s)).toBe(true);
  });

  it('ignores unknown kinds (no write)', async () => {
    const s = makeStorage();
    await markMnemonicAck(s, 'tatoo');
    expect(s.map.has(MNEMONIC_ACK_KEY)).toBe(false);
  });

  it('a throwing setItem does not propagate (best-effort)', async () => {
    const broken = { setItem: async () => { throw new Error('disk full'); } };
    await expect(markMnemonicAck(broken, 'written')).resolves.toBeUndefined();
  });

  it('no-ops on a falsy storage', async () => {
    await expect(markMnemonicAck(null, 'written')).resolves.toBeUndefined();
  });
});

describe('clearMnemonicAck', () => {
  it('clears a previously-set marker', async () => {
    const s = makeStorage({ [MNEMONIC_ACK_KEY]: '1' });
    await clearMnemonicAck(s);
    expect(s.map.has(MNEMONIC_ACK_KEY)).toBe(false);
    expect(await shouldShowCreateMnemonic(s)).toBe(true);
  });

  it('is a no-op on a falsy storage', async () => {
    await expect(clearMnemonicAck(null)).resolves.toBeUndefined();
  });
});

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
