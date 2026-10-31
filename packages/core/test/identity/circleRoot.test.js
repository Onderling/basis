// The persona's CIRCLE ROOT: the derivation root of every per-circle key a persona presents, the same on every full
// device of the persona (the phrase re-derives it), one per epoch (a re-key moves to the next).
import { describe, it, expect } from 'vitest';
import { deriveCircleRoot, deriveCircleAddress } from '../../src/index.js';

const seed = (b) => new Uint8Array(32).fill(b);

describe('deriveCircleRoot', () => {
  it('is deterministic per (persona seed, epoch), 32 bytes', () => {
    const a = deriveCircleRoot(seed(1), 0);
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(deriveCircleAddress(deriveCircleRoot(seed(1), 0), 'c')).toBe(deriveCircleAddress(a, 'c'));
  });
  it('another epoch, another persona, or the seed itself → another address', () => {
    const at = (s, e) => deriveCircleAddress(deriveCircleRoot(s, e), 'c');
    expect(at(seed(1), 1)).not.toBe(at(seed(1), 0));
    expect(at(seed(2), 0)).not.toBe(at(seed(1), 0));
    expect(deriveCircleAddress(seed(1), 'c'), 'never the persona seed\'s own circle key').not.toBe(at(seed(1), 0));
  });
  it('refuses a bad seed or epoch', () => {
    expect(() => deriveCircleRoot(new Uint8Array(3), 0)).toThrow();
    expect(() => deriveCircleRoot(seed(1), -1)).toThrow();
    expect(() => deriveCircleRoot(seed(1), 1.5)).toThrow();
  });
});
