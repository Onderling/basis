import { describe, it, expect } from 'vitest';
import { directChecks } from './lint-one-signature-check.mjs';

const files = { 'a.js': 'const ok = nacl.sign.detached.verify(m, s, k);', 'b.js': 'x = sodium.crypto_sign_verify_detached(s, m, k)', 'c.js': '// nacl.sign.detached.verify(m, s, k) in a comment', 'packages/core/src/crypto/ed25519Strict.js': 'nacl.sign.detached.verify(m, s, k)', 'd.js': 'return verifyEd25519Strict(m, s, k);' };
const read = (f) => files[f];

describe('lint-one-signature-check', () => {
  it('is red for a direct library check outside the one module', () => {
    expect(directChecks(Object.keys(files), read)).toEqual(['a.js:1', 'b.js:1']);
  });
  it('is quiet for the one module, a comment, and a call to the strict check', () => {
    expect(directChecks(['c.js', 'd.js', 'packages/core/src/crypto/ed25519Strict.js'], read)).toEqual([]);
  });
});
