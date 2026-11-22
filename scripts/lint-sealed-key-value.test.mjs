import { describe, it, expect } from 'vitest';
import { rawWrites, problemsAgainst } from './lint-sealed-key-value.mjs';

const files = {
  'apps/basis/src/v2/a.js': "storage?.setItem?.(k, JSON.stringify(v));\nawait AsyncStorage.setItem('cc.x', v);",
  'apps/basis/src/v2/sealedOk.js': 'await kv.setItem(k, v); await sealed.setItem(k, v);',
  'apps/basis/src/v2/localStoreSeal.js': 'await storage.setItem(key, strategy().seal(v));',
  'apps/basis/src/v2/doc.js': '// localStorage.setItem(k, v) in a comment\n * storage.setItem(k, v) in a doc line',
};
const read = (f) => files[f];

describe('lint-sealed-key-value', () => {
  it('counts raw writes, never the sealed ones, the wrapper itself or a comment', () => {
    expect(rawWrites(Object.keys(files), read)).toEqual({ 'apps/basis/src/v2/a.js': 2 });
  });
  it('is red for a new file, a grown one, or a note without a head', () => {
    expect(problemsAgainst({ a: 1 }, {})).toHaveLength(1);
    expect(problemsAgainst({ a: 2 }, { a: { count: 1, note: 'not content: a flag' } })).toHaveLength(1);
    expect(problemsAgainst({ a: 1 }, { a: { count: 1, note: 'because' } })).toHaveLength(1);
    expect(problemsAgainst({ a: 1 }, { a: { count: 1, note: 'debt: the x cache' } })).toEqual([]);
  });
});
