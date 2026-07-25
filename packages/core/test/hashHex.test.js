// hashHex — the kernel's sync cross-platform SHA-256 hex primitive.
import { describe, it, expect } from 'vitest';
import { hashHex } from '../src/hashHex.js';
import { hashHex as hashHexFromIndex } from '../src/index.js';

describe('hashHex', () => {
  it('matches the known SHA-256 vector for "abc" and is deterministic', () => {
    const abc = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(hashHex('abc')).toBe(abc);
    expect(hashHex('abc')).toBe(hashHex('abc'));           // stable across calls
    expect(hashHexFromIndex('abc')).toBe(abc);             // exported from the kernel index
  });
  it('accepts bytes and agrees with the string form', () => {
    expect(hashHex(new TextEncoder().encode('abc'))).toBe(hashHex('abc'));
  });
  it('distinct inputs give distinct digests', () => {
    expect(hashHex('a|b')).not.toBe(hashHex('a|c'));
  });
});
