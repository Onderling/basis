import { describe, it, expect } from 'vitest';
import { directSecretbox, directSecretboxLines, grewAgainst, redMessage } from './lint-one-secretbox.mjs';

const files = {
  'packages/core/src/identity/x.js': "const c = nacl.secretbox(m, n, k);\nconst p = nacl.secretbox.open(c, n, k);",
  'packages/x/src/named.js': "import { secretbox } from 'tweetnacl';",
  'packages/core/src/identity/ok.js': 'const c = secretboxSeal(m, n, k);\nconst l = nacl.secretbox.keyLength;',
  'packages/core/src/crypto/secretbox.js': 'nacl.secretbox(m, n, k)',
  'apps/basis/src/v2/signatureEquations.js': 'sodium.crypto_secretbox_easy(m, n, k); nacl.secretbox(m, n, k)',
  'packages/x/src/comment.js': '// nacl.secretbox(m, n, k) in a comment\n * nacl.secretbox.open(c, n, k) in a doc line',
};
const read = (f) => files[f];

describe('lint-one-secretbox', () => {
  it('counts a direct seal, open or named import, never the port, the implementations, a constant or a comment', () => {
    expect(directSecretbox(Object.keys(files), read)).toEqual({ 'packages/core/src/identity/x.js': 2, 'packages/x/src/named.js': 1 });
  });
  it('is red when a file grows past its baseline or a new file appears; a shrink is fine', () => {
    expect(grewAgainst({ a: 2, b: 1 }, { a: 2 })).toEqual([{ file: 'b', now: 1, was: 0 }]);
    expect(grewAgainst({ a: 1 }, { a: 2 })).toEqual([]);
  });
  it('the red message names each site as file:line and says what to call instead', () => {
    const lines = directSecretboxLines(Object.keys(files), read);
    const msg = redMessage(grewAgainst(directSecretbox(Object.keys(files), read), {}), lines);
    expect(msg).toMatch(/packages\/core\/src\/identity\/x\.js:2\b/);
    expect(msg).toMatch(/packages\/x\/src\/named\.js:1\b/);
    expect(msg).toMatch(/^Fix: .*secretbox\.js/m);
  });
});
