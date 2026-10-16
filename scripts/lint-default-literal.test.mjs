// The 'default'-literal guard: it counts the literal, and a count above the baseline is reported.
import { describe, it, expect } from 'vitest';
import { countDefaultLiterals, grown } from './lint-default-literal.mjs';

describe("the 'default'-literal guard", () => {
  it('counts both quote forms, not words that merely contain it', () => {
    expect(countDefaultLiterals(`personas.get('default'); x === "default"; defaultProfile; 'defaults'`)).toBe(2);
  });
  it('reports a file whose count rose, never one that fell', () => {
    expect(grown({ a: 3, b: 1 }, { a: 2, b: 4 })).toEqual([{ file: 'a', was: 2, now: 3 }]);
    expect(grown({ c: 1 }, {})).toEqual([{ file: 'c', was: 0, now: 1 }]);
  });
});
