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
  it('catches node:crypto and WebCrypto checks too, and exempts only the vetted equations module', () => {
    const more = {
      'e.js': 'const ok = crypto.verify(null, msg, key, sig);',
      'f.js': 'await crypto.subtle.verify({ name: \'Ed25519\' }, k, sig, msg);',
      'apps/basis/src/v2/signatureEquations.js': 'nodeCrypto.verify(null, msg, k, sig); sodium.crypto_sign_verify_detached(sig, msg, key);',
    };
    expect(directChecks(Object.keys(more), (f) => more[f])).toEqual(['e.js:1', 'f.js:1']);
  });
});
