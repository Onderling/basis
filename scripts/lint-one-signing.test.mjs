import { describe, it, expect } from 'vitest';
import { directSigning, directSigningLines, grewAgainst, redMessage } from './lint-one-signing.mjs';

const files = {
  'packages/core/src/identity/x.js': "const s = nacl.sign.detached(m, k);\nconst kp = nacl.sign.keyPair.fromSeed(seed);",
  'packages/core/src/identity/ok.js': "const s = ed25519Sign(m, k);\nnacl.sign.detached.verify(m, s, p); // a check, not a signature",
  'packages/core/src/crypto/ed25519Sign.js': 'nacl.sign.detached(m, k)',
  'apps/basis/src/v2/signatureEquations.js': 'sodium.crypto_sign_detached(m, k); nacl.sign.detached(m, k)',
  'packages/x/src/comment.js': '// nacl.sign.detached(m, k) in a comment\n * nacl.sign.keyPair.fromSeed(s) in a doc line',
};
const read = (f) => files[f];

describe('lint-one-signing', () => {
  it('counts a direct signature or seed derivation, never the port, the implementations, a check or a comment', () => {
    expect(directSigning(Object.keys(files), read)).toEqual({ 'packages/core/src/identity/x.js': 2 });
  });
  it('is red when a file grows past its baseline or a new file appears; a shrink is fine', () => {
    expect(grewAgainst({ a: 2, b: 1 }, { a: 2 })).toEqual([{ file: 'b', now: 1, was: 0 }]);
    expect(grewAgainst({ a: 3 }, { a: 2 })).toEqual([{ file: 'a', now: 3, was: 2 }]);
    expect(grewAgainst({ a: 1 }, { a: 2, c: 1 })).toEqual([]);
  });
  it('the red message names each site as file:line and says what to call instead', () => {
    const lines = directSigningLines(Object.keys(files), read);
    const msg = redMessage(grewAgainst(directSigning(Object.keys(files), read), {}), lines);
    expect(msg).toMatch(/packages\/core\/src\/identity\/x\.js:1\b/);
    expect(msg).toMatch(/packages\/core\/src\/identity\/x\.js:2\b/);
    expect(msg).toMatch(/^Fix: .*ed25519Sign/m);
  });
});
